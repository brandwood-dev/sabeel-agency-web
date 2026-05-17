import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, Repository } from 'typeorm';
import { StripeWebhookEvent } from './entities/stripe-webhook-event.entity';
import { STRIPE_DOMAIN_EVENTS } from './domain-events/stripe-domain-events';
import { WalletService } from '../wallet/wallet.service';
import { ObservabilityService } from '../observability/observability.service';
import { Wallet, WalletOwnerType } from '../wallet/entities/wallet.entity';
import {
  StripeObjectType,
  WalletTransaction,
  WalletTransactionType,
} from '../wallet/entities/wallet-transaction.entity';
import { WithdrawalRequest, WithdrawalRequestStatus } from '../wallet/entities/withdrawal-request.entity';

type StripeEventLike = {
  id: string;
  type: string;
  created?: number;
  livemode?: boolean;
  account?: string;
  api_version?: string;
  data?: { object?: any };
};

type WebhookTxResult = {
  duplicate: boolean;
  emittedEvents: string[];
  domainPayload?: Record<string, any>;
};

const DEFAULT_PLATFORM_OWNER_ID = '00000000-0000-0000-0000-000000000000';

@Injectable()
export class StripeWebhookService {
  private readonly logger = new Logger(StripeWebhookService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
    private readonly walletService: WalletService,
    private readonly observability: ObservabilityService,
    @InjectRepository(StripeWebhookEvent)
    private readonly eventRepository: Repository<StripeWebhookEvent>,
  ) {}

  async hasProcessed(eventId: string) {
    const existing = await this.eventRepository.findOne({ where: { eventId } });
    return !!existing;
  }

  async recordAndDispatch(event: StripeEventLike) {
    const startedAt = Date.now();
    const sanitized = this.sanitizeEvent(event);

    const correlationId = event?.id ? String(event.id) : `stripe:${Date.now()}`;

    let emittedEvents: string[] = [];
    let domainPayload: Record<string, any> = {};

    const txResult: WebhookTxResult = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(StripeWebhookEvent);

      const existing = await repo.findOne({ where: { eventId: event.id } });
      if (existing) {
        this.logger.log(JSON.stringify({ msg: 'stripe_event_duplicate', eventId: event.id, type: event.type }));
        return { duplicate: true, emittedEvents: [] as string[] };
      }

      await repo.save(
        repo.create({
          eventId: event.id,
          type: event.type,
          objectType: sanitized.objectType,
          objectId: sanitized.objectId,
          amount: sanitized.amount,
          currency: sanitized.currency,
          status: sanitized.status,
          customerId: sanitized.customerId,
          accountId: sanitized.accountId,
          paymentIntentId: sanitized.paymentIntentId,
          transferId: sanitized.transferId,
          payoutId: sanitized.payoutId,
          refundId: sanitized.refundId,
          eventCreatedAtUnix: sanitized.eventCreatedAtUnix,
          apiVersion: (event as any).api_version || null,
          livemode: String((event as any).livemode ?? ''),
          sanitizedPayload: sanitized.sanitizedPayload,
        }),
      );

      // Route handlers by event type
      const handled = await this.dispatch(manager, event);
      emittedEvents = handled.emittedEvents;
      domainPayload = handled.domainPayload || {};

      return { duplicate: false, emittedEvents, domainPayload };
    });

    // Emit domain events ONLY after DB commit
    if (!txResult.duplicate) {
      const payload = {
        eventName: null as any,
        correlationId,
        stripeEventId: event.id,
        stripeType: event.type,
        objectId: sanitized.objectId,
        amount: sanitized.amount,
        currency: sanitized.currency,
        status: sanitized.status,
        metadata: sanitized.sanitizedPayload?.metadata || null,
        occurredAt: new Date().toISOString(),
        ...(txResult.domainPayload || {}),
      };

      for (const name of txResult.emittedEvents || []) {
        try {
          (payload as any).eventName = name;
          this.eventEmitter.emit(name, payload);
        } catch (e: any) {
          this.logger.error(
            JSON.stringify({
              msg: 'domain_event_emit_error',
              name,
              stripeEventId: event.id,
              error: String(e?.message || e),
            }),
          );
        }
      }
    }

    const durationMs = Date.now() - startedAt;

    // Observability metrics
    try {
      const obj: any = (event as any)?.data?.object || {};
      const flow = obj?.metadata?.flow ? String(obj.metadata.flow) : '';
      this.observability.stripeWebhookProcessedTotal.inc({
        stripe_type: String(event.type || ''),
        flow,
        result: txResult.duplicate ? 'duplicate' : 'processed',
      });
      this.observability.stripeWebhookDurationMs.observe(
        { stripe_type: String(event.type || ''), flow },
        durationMs,
      );
    } catch {
      // metrics must not break webhook
    }

    this.logger.log(
      JSON.stringify({
        msg: 'stripe_webhook_processed',
        correlationId,
        eventId: event.id,
        type: event.type,
        duplicate: txResult.duplicate,
        durationMs,
        emittedEvents: txResult.emittedEvents || [],
      }),
    );

    return txResult;
  }

  private async dispatch(manager: any, event: StripeEventLike) {
    const base = { eventId: event.id, type: event.type };

    try {
      switch (event.type) {
        case 'payment_intent.succeeded':
          this.logger.log(JSON.stringify({ ...base, msg: 'stripe_event_received' }));
          {
            const obj: any = (event as any)?.data?.object || {};
            const flow = obj?.metadata?.flow ? String(obj.metadata.flow) : '';

            if (flow === 'topup') {
              const domainPayload = await this.handleTopupSucceeded(manager, event);
              return { emittedEvents: [STRIPE_DOMAIN_EVENTS.WALLET_TOPUP_SUCCEEDED], domainPayload };
            }

            if (flow === 'direct_payment') {
              const domainPayload = await this.handleDirectPaymentSucceeded(manager, event);
              return { emittedEvents: [STRIPE_DOMAIN_EVENTS.PAYMENT_DIRECT_COMPLETED], domainPayload };
            }

            // Default (safe) behavior
            const domainPayload = await this.handleDirectPaymentSucceeded(manager, event);
            return { emittedEvents: [STRIPE_DOMAIN_EVENTS.PAYMENT_DIRECT_COMPLETED], domainPayload };
          }
        case 'payment_intent.payment_failed':
          this.logger.warn(JSON.stringify({ ...base, msg: 'stripe_event_received' }));
          return { emittedEvents: [], domainPayload: {} };
        case 'charge.refunded':
          this.logger.log(JSON.stringify({ ...base, msg: 'stripe_event_received' }));
          {
            const domainPayload = await this.handleRefund(manager, event);
            return { emittedEvents: [STRIPE_DOMAIN_EVENTS.REFUND_COMPLETED], domainPayload };
          }
        case 'transfer.created':
          {
            this.logger.log(JSON.stringify({ ...base, msg: 'stripe_event_received' }));
            const domainPayload = await this.handleWalletPaymentTransferCreated(manager, event);
            return { emittedEvents: [STRIPE_DOMAIN_EVENTS.PAYMENT_WALLET_COMPLETED], domainPayload };
          }
        case 'transfer.reversed':
          this.logger.log(JSON.stringify({ ...base, msg: 'stripe_event_received' }));
          {
            const domainPayload = await this.handleWalletPaymentTransferReversed(manager, event);
            return { emittedEvents: [STRIPE_DOMAIN_EVENTS.REFUND_COMPLETED], domainPayload };
          }
        case 'payout.paid':
          {
            this.logger.log(JSON.stringify({ ...base, msg: 'stripe_event_received' }));
            const domainPayload = await this.handlePayoutPaid(manager, event);
            return { emittedEvents: [STRIPE_DOMAIN_EVENTS.WITHDRAWAL_PAID], domainPayload };
          }
        case 'payout.failed':
          this.logger.log(JSON.stringify({ ...base, msg: 'stripe_event_received' }));
          {
            const domainPayload = await this.handlePayoutFailed(manager, event);
            return { emittedEvents: [STRIPE_DOMAIN_EVENTS.WITHDRAWAL_FAILED], domainPayload };
          }
        default:
          this.logger.debug(JSON.stringify({ ...base, msg: 'stripe_event_ignored' }));
          return { emittedEvents: [], domainPayload: {} };
      }
    } catch (e: any) {
      this.logger.error(JSON.stringify({ ...base, msg: 'stripe_event_error', error: String(e?.message || e) }));
      throw e;
    }
  }

  private requireMetadata(obj: any, key: string) {
    const value = obj?.metadata?.[key];
    if (value === undefined || value === null || String(value).trim() === '') {
      throw new BadRequestException(`Missing Stripe metadata: ${key}`);
    }
    return String(value);
  }

  private toIntCents(value: any, fieldName: string) {
    const n = Number(value);
    if (!Number.isFinite(n) || Math.floor(n) !== n) {
      throw new BadRequestException(`Invalid integer cents for ${fieldName}`);
    }
    return n;
  }

  private async getOrCreateWalletInTx(manager: any, params: { ownerType: WalletOwnerType; ownerId: string }) {
    const repo = manager.getRepository(Wallet);
    const existing = await repo.findOne({ where: { ownerType: params.ownerType, ownerId: params.ownerId } });
    if (existing) return existing;

    const created = repo.create({
      ownerType: params.ownerType,
      ownerId: params.ownerId,
      currency: 'MAD',
      availableBalance: 0,
      pendingBalance: 0,
    });
    return repo.save(created);
  }

  private async getPlatformWalletInTx(manager: any) {
    return this.getOrCreateWalletInTx(manager, {
      ownerType: WalletOwnerType.PLATFORM,
      ownerId: DEFAULT_PLATFORM_OWNER_ID,
    });
  }

  private async handleTopupSucceeded(manager: any, event: StripeEventLike) {
    const pi: any = (event as any)?.data?.object || {};
    const pilgrimUserId = this.requireMetadata(pi, 'pilgrimUserId');
    const amount = this.toIntCents(pi.amount, 'payment_intent.amount');

    const pilgrimWallet = await this.getOrCreateWalletInTx(manager, {
      ownerType: WalletOwnerType.PILGRIM,
      ownerId: pilgrimUserId,
    });

    // Ledger tx (idempotent by idempotencyKey)
    const tx = await this.walletService.createWalletTransactionInTransaction(manager, {
      type: WalletTransactionType.TOPUP,
      amount,
      currency: String(pi.currency || 'MAD').toUpperCase(),
      fromWalletId: null,
      toWalletId: pilgrimWallet.id,
      stripeObjectType: StripeObjectType.PAYMENT_INTENT,
      stripeObjectId: String(pi.id || ''),
      stripeEventId: event.id,
      referenceType: this.requireMetadata(pi, 'referenceType'),
      referenceId: this.requireMetadata(pi, 'referenceId'),
      metadata: { flow: 'topup' },
      idempotencyKey: `${event.id}:topup`,
    });

    // Balance update
    await this.walletService.applyBalanceDeltaInTransaction(manager, {
      actorUserId: pilgrimUserId,
      actorRole: 'pilgrim',
      walletId: pilgrimWallet.id,
      availableDelta: amount,
      pendingDelta: 0,
      auditMessage: 'Topup succeeded',
      auditData: { stripeEventId: event.id, paymentIntentId: String(pi.id || '') },
    });

    return {
      toWalletId: pilgrimWallet.id,
      walletTransactionIds: [tx.id],
      referenceType: this.requireMetadata(pi, 'referenceType'),
      referenceId: this.requireMetadata(pi, 'referenceId'),
    };
  }

  private async handleDirectPaymentSucceeded(manager: any, event: StripeEventLike) {
    const pi: any = (event as any)?.data?.object || {};
    const recipientType = this.requireMetadata(pi, 'recipientType');
    const recipientId = this.requireMetadata(pi, 'recipientId');
    const totalAmount = this.toIntCents(pi.amount, 'payment_intent.amount');
    const commissionAmount = this.toIntCents(this.requireMetadata(pi, 'commissionAmountCents'), 'commissionAmountCents');
    const netAmount = totalAmount - commissionAmount;
    if (netAmount < 0) {
      throw new BadRequestException('Commission exceeds total amount');
    }

    const platformWallet = await this.getPlatformWalletInTx(manager);
    const receiverOwnerType = recipientType === 'AGENCY' ? WalletOwnerType.AGENCY : WalletOwnerType.GUIDE;
    const receiverWallet = await this.getOrCreateWalletInTx(manager, {
      ownerType: receiverOwnerType,
      ownerId: recipientId,
    });

    const referenceType = this.requireMetadata(pi, 'referenceType');
    const referenceId = this.requireMetadata(pi, 'referenceId');

    const commissionTx = await this.walletService.createWalletTransactionInTransaction(manager, {
      type: WalletTransactionType.COMMISSION,
      amount: commissionAmount,
      currency: String(pi.currency || 'MAD').toUpperCase(),
      fromWalletId: null,
      toWalletId: platformWallet.id,
      stripeObjectType: StripeObjectType.PAYMENT_INTENT,
      stripeObjectId: String(pi.id || ''),
      stripeEventId: event.id,
      referenceType,
      referenceId,
      metadata: { flow: 'direct_payment', recipientType, recipientId },
      idempotencyKey: `${event.id}:direct:commission`,
    });

    const earningTx = await this.walletService.createWalletTransactionInTransaction(manager, {
      type: WalletTransactionType.EARNING,
      amount: netAmount,
      currency: String(pi.currency || 'MAD').toUpperCase(),
      fromWalletId: null,
      toWalletId: receiverWallet.id,
      stripeObjectType: StripeObjectType.PAYMENT_INTENT,
      stripeObjectId: String(pi.id || ''),
      stripeEventId: event.id,
      referenceType,
      referenceId,
      metadata: { flow: 'direct_payment', recipientType, recipientId },
      idempotencyKey: `${event.id}:direct:earning`,
    });

    await this.walletService.applyBalanceDeltaInTransaction(manager, {
      walletId: platformWallet.id,
      availableDelta: commissionAmount,
      pendingDelta: 0,
      auditMessage: 'Direct payment commission credited',
      auditData: { stripeEventId: event.id, paymentIntentId: String(pi.id || '') },
    });

    await this.walletService.applyBalanceDeltaInTransaction(manager, {
      walletId: receiverWallet.id,
      availableDelta: netAmount,
      pendingDelta: 0,
      auditMessage: 'Direct payment earning credited',
      auditData: { stripeEventId: event.id, paymentIntentId: String(pi.id || '') },
    });

    return {
      toWalletId: receiverWallet.id,
      walletTransactionIds: [commissionTx.id, earningTx.id],
      referenceType,
      referenceId,
    };
  }

  private async handleWalletPaymentTransferCreated(manager: any, event: StripeEventLike) {
    const tr: any = (event as any)?.data?.object || {};
    const pilgrimUserId = this.requireMetadata(tr, 'pilgrimUserId');
    const recipientType = this.requireMetadata(tr, 'recipientType');
    const recipientId = this.requireMetadata(tr, 'recipientId');

    const totalAmount = this.toIntCents(this.requireMetadata(tr, 'totalAmountCents'), 'totalAmountCents');
    const commissionAmount = this.toIntCents(this.requireMetadata(tr, 'commissionAmountCents'), 'commissionAmountCents');
    const netAmount = this.toIntCents(tr.amount, 'transfer.amount');
    if (totalAmount - commissionAmount !== netAmount) {
      throw new BadRequestException('Transfer amount mismatch with total/commission');
    }

    const platformWallet = await this.getPlatformWalletInTx(manager);
    const pilgrimWallet = await this.getOrCreateWalletInTx(manager, {
      ownerType: WalletOwnerType.PILGRIM,
      ownerId: pilgrimUserId,
    });
    const receiverOwnerType = recipientType === 'AGENCY' ? WalletOwnerType.AGENCY : WalletOwnerType.GUIDE;
    const receiverWallet = await this.getOrCreateWalletInTx(manager, {
      ownerType: receiverOwnerType,
      ownerId: recipientId,
    });

    const referenceType = this.requireMetadata(tr, 'referenceType');
    const referenceId = this.requireMetadata(tr, 'referenceId');

    const paymentTx = await this.walletService.createWalletTransactionInTransaction(manager, {
      type: WalletTransactionType.PAYMENT,
      amount: totalAmount,
      currency: String(tr.currency || 'MAD').toUpperCase(),
      fromWalletId: pilgrimWallet.id,
      toWalletId: receiverWallet.id,
      stripeObjectType: StripeObjectType.TRANSFER,
      stripeObjectId: String(tr.id || ''),
      stripeEventId: event.id,
      referenceType,
      referenceId,
      metadata: { flow: 'wallet_payment', recipientType, recipientId },
      idempotencyKey: `${event.id}:wallet:payment`,
    });

    const commissionTx = await this.walletService.createWalletTransactionInTransaction(manager, {
      type: WalletTransactionType.COMMISSION,
      amount: commissionAmount,
      currency: String(tr.currency || 'MAD').toUpperCase(),
      fromWalletId: pilgrimWallet.id,
      toWalletId: platformWallet.id,
      stripeObjectType: StripeObjectType.TRANSFER,
      stripeObjectId: String(tr.id || ''),
      stripeEventId: event.id,
      referenceType,
      referenceId,
      metadata: { flow: 'wallet_payment', recipientType, recipientId },
      idempotencyKey: `${event.id}:wallet:commission`,
    });

    const earningTx = await this.walletService.createWalletTransactionInTransaction(manager, {
      type: WalletTransactionType.EARNING,
      amount: netAmount,
      currency: String(tr.currency || 'MAD').toUpperCase(),
      fromWalletId: pilgrimWallet.id,
      toWalletId: receiverWallet.id,
      stripeObjectType: StripeObjectType.TRANSFER,
      stripeObjectId: String(tr.id || ''),
      stripeEventId: event.id,
      referenceType,
      referenceId,
      metadata: { flow: 'wallet_payment', recipientType, recipientId },
      idempotencyKey: `${event.id}:wallet:earning`,
    });

    // Apply balance deltas atomically
    await this.walletService.applyBalanceDeltaInTransaction(manager, {
      actorUserId: pilgrimUserId,
      actorRole: 'pilgrim',
      walletId: pilgrimWallet.id,
      availableDelta: -totalAmount,
      pendingDelta: 0,
      auditMessage: 'Wallet payment debited',
      auditData: { stripeEventId: event.id, transferId: String(tr.id || '') },
    });

    await this.walletService.applyBalanceDeltaInTransaction(manager, {
      walletId: platformWallet.id,
      availableDelta: commissionAmount,
      pendingDelta: 0,
      auditMessage: 'Wallet payment commission credited',
      auditData: { stripeEventId: event.id, transferId: String(tr.id || '') },
    });

    await this.walletService.applyBalanceDeltaInTransaction(manager, {
      walletId: receiverWallet.id,
      availableDelta: netAmount,
      pendingDelta: 0,
      auditMessage: 'Wallet payment earning credited',
      auditData: { stripeEventId: event.id, transferId: String(tr.id || '') },
    });

    return {
      fromWalletId: pilgrimWallet.id,
      toWalletId: receiverWallet.id,
      walletTransactionIds: [paymentTx.id, commissionTx.id, earningTx.id],
      referenceType,
      referenceId,
    };
  }

  private async handleWalletPaymentTransferReversed(manager: any, event: StripeEventLike) {
    // For reversals, we reverse the wallet-pay ledger by reading reversal metadata.
    const tr: any = (event as any)?.data?.object || {};
    const pilgrimUserId = this.requireMetadata(tr, 'pilgrimUserId');
    const recipientType = this.requireMetadata(tr, 'recipientType');
    const recipientId = this.requireMetadata(tr, 'recipientId');

    const totalAmount = this.toIntCents(this.requireMetadata(tr, 'totalAmountCents'), 'totalAmountCents');
    const commissionAmount = this.toIntCents(this.requireMetadata(tr, 'commissionAmountCents'), 'commissionAmountCents');
    const netAmount = totalAmount - commissionAmount;
    if (netAmount < 0) {
      throw new BadRequestException('Commission exceeds total amount');
    }

    const platformWallet = await this.getPlatformWalletInTx(manager);
    const pilgrimWallet = await this.getOrCreateWalletInTx(manager, {
      ownerType: WalletOwnerType.PILGRIM,
      ownerId: pilgrimUserId,
    });
    const receiverOwnerType = recipientType === 'AGENCY' ? WalletOwnerType.AGENCY : WalletOwnerType.GUIDE;
    const receiverWallet = await this.getOrCreateWalletInTx(manager, {
      ownerType: receiverOwnerType,
      ownerId: recipientId,
    });

    const referenceType = this.requireMetadata(tr, 'referenceType');
    const referenceId = this.requireMetadata(tr, 'referenceId');

    const refundTx = await this.walletService.createWalletTransactionInTransaction(manager, {
      type: WalletTransactionType.REFUND,
      amount: totalAmount,
      currency: String(tr.currency || 'MAD').toUpperCase(),
      fromWalletId: receiverWallet.id,
      toWalletId: pilgrimWallet.id,
      stripeObjectType: StripeObjectType.TRANSFER,
      stripeObjectId: String(tr.id || ''),
      stripeEventId: event.id,
      referenceType,
      referenceId,
      metadata: { flow: 'wallet_payment_reversal', recipientType, recipientId },
      idempotencyKey: `${event.id}:wallet:reversal`,
    });

    await this.walletService.applyBalanceDeltaInTransaction(manager, {
      walletId: pilgrimWallet.id,
      availableDelta: totalAmount,
      pendingDelta: 0,
      auditMessage: 'Wallet payment refunded to pilgrim',
      auditData: { stripeEventId: event.id, transferId: String(tr.id || '') },
    });

    await this.walletService.applyBalanceDeltaInTransaction(manager, {
      walletId: platformWallet.id,
      availableDelta: -commissionAmount,
      pendingDelta: 0,
      auditMessage: 'Wallet payment commission reversed',
      auditData: { stripeEventId: event.id, transferId: String(tr.id || '') },
    });

    await this.walletService.applyBalanceDeltaInTransaction(manager, {
      walletId: receiverWallet.id,
      availableDelta: -netAmount,
      pendingDelta: 0,
      auditMessage: 'Wallet payment earning reversed',
      auditData: { stripeEventId: event.id, transferId: String(tr.id || '') },
    });

    return {
      fromWalletId: receiverWallet.id,
      toWalletId: pilgrimWallet.id,
      walletTransactionIds: [refundTx.id],
      referenceType,
      referenceId,
    };
  }

  private async handleRefund(manager: any, event: StripeEventLike) {
    // Refunds for direct payments: reverse credited commission + earning.
    const charge: any = (event as any)?.data?.object || {};
    const paymentIntentId = charge?.payment_intent ? String(charge.payment_intent) : null;
    if (!paymentIntentId) {
      throw new BadRequestException('Missing payment_intent on refunded charge');
    }

    const refunded = this.toIntCents(charge.amount_refunded, 'charge.amount_refunded');
    const currency = String(charge.currency || 'MAD').toUpperCase();

    // Find original earning/commission to compute proportional reversal
    const txRepo = manager.getRepository(WalletTransaction);
    const original = await txRepo.find({
      where: {
        stripeObjectType: StripeObjectType.PAYMENT_INTENT as any,
        stripeObjectId: paymentIntentId as any,
      } as any,
      order: { createdAt: 'ASC' } as any,
    });

    const commissionTx = original.find((t: any) => t.type === WalletTransactionType.COMMISSION);
    const earningTx = original.find((t: any) => t.type === WalletTransactionType.EARNING);
    if (!commissionTx || !earningTx) {
      throw new BadRequestException('Original direct payment ledger not found');
    }

    const total = Number(commissionTx.amount) + Number(earningTx.amount);
    if (total <= 0) {
      throw new BadRequestException('Invalid original payment total');
    }

    const commissionRefund = Math.round((Number(commissionTx.amount) / total) * refunded);
    const earningRefund = refunded - commissionRefund;

    const platformWallet = await manager.getRepository(Wallet).findOne({ where: { id: commissionTx.toWalletId } });
    const receiverWallet = await manager.getRepository(Wallet).findOne({ where: { id: earningTx.toWalletId } });
    if (!platformWallet || !receiverWallet) {
      throw new BadRequestException('Wallets not found for refund');
    }

    const refundLedger = await this.walletService.createWalletTransactionInTransaction(manager, {
      type: WalletTransactionType.REFUND,
      amount: refunded,
      currency,
      fromWalletId: null,
      toWalletId: null,
      stripeObjectType: StripeObjectType.REFUND,
      stripeObjectId: String(charge.refunds?.data?.[0]?.id || charge.id || ''),
      stripeEventId: event.id,
      referenceType: commissionTx.referenceType,
      referenceId: commissionTx.referenceId,
      metadata: { paymentIntentId, chargeId: String(charge.id || '') },
      idempotencyKey: `${event.id}:refund:${paymentIntentId}:${refunded}`,
    });

    await this.walletService.applyBalanceDeltaInTransaction(manager, {
      walletId: platformWallet.id,
      availableDelta: -commissionRefund,
      pendingDelta: 0,
      auditMessage: 'Direct payment commission refunded',
      auditData: { stripeEventId: event.id, paymentIntentId, refunded },
    });

    await this.walletService.applyBalanceDeltaInTransaction(manager, {
      walletId: receiverWallet.id,
      availableDelta: -earningRefund,
      pendingDelta: 0,
      auditMessage: 'Direct payment earning refunded',
      auditData: { stripeEventId: event.id, paymentIntentId, refunded },
    });

    return {
      walletTransactionIds: [refundLedger.id],
      referenceType: commissionTx.referenceType,
      referenceId: commissionTx.referenceId,
    };
  }

  private async handlePayoutPaid(manager: any, event: StripeEventLike) {
    const payout: any = (event as any)?.data?.object || {};
    const payoutId = payout?.id ? String(payout.id) : null;
    if (!payoutId) {
      throw new BadRequestException('Missing payout id');
    }

    // Find withdrawal request and finalize
    const wrRepo = manager.getRepository(WithdrawalRequest);
    const request = await wrRepo.findOne({
      where: { stripePayoutId: payoutId } as any,
      lock: { mode: 'pessimistic_write' },
    });

    if (!request) {
      // Not all payouts are from our system, ignore
      return { payoutId };
    }

    if (request.status === WithdrawalRequestStatus.PAID) {
      return { payoutId, withdrawalRequestId: request.id };
    }

    if (request.status !== WithdrawalRequestStatus.PROCESSING) {
      this.logger.warn(
        JSON.stringify({
          msg: 'withdrawal_payout_paid_unexpected_state',
          payoutId,
          withdrawalRequestId: request.id,
          status: request.status,
        }),
      );
      return { payoutId, withdrawalRequestId: request.id, ignored: true };
    }

    request.status = WithdrawalRequestStatus.PAID;
    request.failureReason = null;
    await wrRepo.save(request);

    const ledger = await this.walletService.createWalletTransactionInTransaction(manager, {
      type: WalletTransactionType.WITHDRAWAL_PAID,
      amount: request.amount,
      currency: request.currency || 'MAD',
      fromWalletId: request.walletId,
      toWalletId: null,
      stripeObjectType: StripeObjectType.PAYOUT,
      stripeObjectId: payoutId,
      stripeEventId: event.id,
      referenceType: 'withdrawal',
      referenceId: request.id,
      metadata: { payoutId },
      idempotencyKey: `${event.id}:withdrawal:paid:${request.id}`,
    });

    // Pending -> removed
    await this.walletService.applyBalanceDeltaInTransaction(manager, {
      walletId: request.walletId,
      availableDelta: 0,
      pendingDelta: -request.amount,
      auditMessage: 'Withdrawal paid',
      auditData: { stripeEventId: event.id, payoutId, withdrawalRequestId: request.id },
    });

    return { withdrawalRequestId: request.id, walletTransactionIds: [ledger.id] };
  }

  private async handlePayoutFailed(manager: any, event: StripeEventLike) {
    const payout: any = (event as any)?.data?.object || {};
    const payoutId = payout?.id ? String(payout.id) : null;
    if (!payoutId) {
      throw new BadRequestException('Missing payout id');
    }

    const wrRepo = manager.getRepository(WithdrawalRequest);
    const request = await wrRepo.findOne({
      where: { stripePayoutId: payoutId } as any,
      lock: { mode: 'pessimistic_write' },
    });

    if (!request) {
      return { payoutId };
    }

    if (request.status !== WithdrawalRequestStatus.PROCESSING) {
      this.logger.warn(
        JSON.stringify({
          msg: 'withdrawal_payout_failed_unexpected_state',
          payoutId,
          withdrawalRequestId: request.id,
          status: request.status,
        }),
      );
      return { payoutId, withdrawalRequestId: request.id, ignored: true };
    }

    request.status = WithdrawalRequestStatus.FAILED;
    request.failureReason = payout?.failure_message ? String(payout.failure_message) : 'payout_failed';
    await wrRepo.save(request);

    // Revert pending -> available
    await this.walletService.applyBalanceDeltaInTransaction(manager, {
      walletId: request.walletId,
      availableDelta: request.amount,
      pendingDelta: -request.amount,
      auditMessage: 'Withdrawal failed - reverted to available',
      auditData: { stripeEventId: event.id, payoutId, withdrawalRequestId: request.id },
    });

    return { withdrawalRequestId: request.id };
  }

  private sanitizeEvent(event: StripeEventLike) {
    const obj: any = (event as any)?.data?.object || {};

    const objectType = String(obj?.object || '');
    const objectId = obj?.id ? String(obj.id) : null;

    const amountCandidate =
      typeof obj?.amount === 'number'
        ? obj.amount
        : typeof obj?.amount_total === 'number'
          ? obj.amount_total
          : typeof obj?.amount_received === 'number'
            ? obj.amount_received
            : typeof obj?.amount_refunded === 'number'
              ? obj.amount_refunded
              : null;

    const currency = obj?.currency ? String(obj.currency).toUpperCase() : null;
    const status = obj?.status ? String(obj.status) : null;

    const customerId = obj?.customer ? String(obj.customer) : null;
    const accountId = (event as any)?.account ? String((event as any).account) : null;

    const paymentIntentId =
      obj?.payment_intent
        ? String(obj.payment_intent)
        : obj?.object === 'payment_intent' && obj?.id
          ? String(obj.id)
          : null;

    const transferId = obj?.object === 'transfer' && obj?.id ? String(obj.id) : null;
    const payoutId = obj?.object === 'payout' && obj?.id ? String(obj.id) : null;
    const refundId = obj?.object === 'refund' && obj?.id ? String(obj.id) : null;

    const safeMetadata = obj?.metadata && typeof obj.metadata === 'object' ? obj.metadata : null;

    // sanitized payload: keep safe fields only (no card details)
    const sanitizedPayload = {
      eventId: event.id,
      type: event.type,
      objectType,
      objectId,
      amount: amountCandidate,
      currency,
      status,
      customerId,
      accountId,
      paymentIntentId,
      transferId,
      payoutId,
      refundId,
      created: (event as any)?.created ?? null,
      livemode: (event as any)?.livemode ?? null,
      metadata: safeMetadata,
    };

    return {
      objectType: objectType || null,
      objectId,
      amount: typeof amountCandidate === 'number' ? amountCandidate : null,
      currency,
      status,
      customerId,
      accountId,
      paymentIntentId,
      transferId,
      payoutId,
      refundId,
      eventCreatedAtUnix:
        typeof (event as any)?.created === 'number' ? String((event as any).created) : null,
      sanitizedPayload,
    };
  }
}
