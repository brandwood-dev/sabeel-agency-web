import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StripeService } from '../stripe/stripe.service';
import { WalletService } from '../wallet/wallet.service';
import { WalletOwnerType } from '../wallet/entities/wallet.entity';
import { Guide } from '../sabeel-guide/auth/entities/guide.entity';
import { AdminAgenceUser } from '../admin_agence/auth/entities/admin-agence-user.entity';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly stripeService: StripeService,
    private readonly walletService: WalletService,
    @InjectRepository(Guide)
    private readonly guideRepository: Repository<Guide>,
    @InjectRepository(AdminAgenceUser)
    private readonly agencyRepository: Repository<AdminAgenceUser>,
  ) {}

  private toIntCents(value: any, field: string) {
    const n = Number(value);
    if (!Number.isFinite(n) || Math.floor(n) !== n || n <= 0) {
      throw new BadRequestException(`Invalid ${field}`);
    }
    return n;
  }

  private async getConnectedAccountId(params: { recipientType: 'GUIDE' | 'AGENCY'; recipientId: string }) {
    if (params.recipientType === 'GUIDE') {
      const guide = await this.guideRepository.findOne({ where: { id: params.recipientId } });
      if (!guide) throw new BadRequestException('Guide not found');
      if (!guide.stripeConnectedAccountId) throw new BadRequestException('Guide is not onboarded to Stripe Connect');
      return guide.stripeConnectedAccountId;
    }

    const agency = await this.agencyRepository.findOne({ where: { id: params.recipientId } });
    if (!agency) throw new BadRequestException('Agency not found');
    if (!agency.stripeConnectedAccountId) throw new BadRequestException('Agency is not onboarded to Stripe Connect');
    return agency.stripeConnectedAccountId;
  }

  async getMyConnectPayoutMethodSummary(params: { user: { userId: string; activeRole?: string } }) {
    const stripe = this.stripeService.getClient();

    const pickLast4 = (list: any) => {
      const items = Array.isArray(list?.data) ? list.data : [];
      const found = items.find((x: any) => x && x.last4);
      return found?.last4 ? String(found.last4) : null;
    };

    const guide = await this.guideRepository.findOne({ where: { id: params.user.userId } });
    if (guide) {
      if (!guide.stripeConnectedAccountId) {
        return { connected: false, last4: null, object: null };
      }

      const accountId = guide.stripeConnectedAccountId;
      const bankAccounts = await stripe.accounts.listExternalAccounts(accountId, {
        object: 'bank_account',
        limit: 10,
      });

      const bankLast4 = pickLast4(bankAccounts as any);
      if (bankLast4) return { connected: true, last4: bankLast4, object: 'bank_account' };

      const cards = await stripe.accounts.listExternalAccounts(accountId, {
        object: 'card',
        limit: 10,
      });

      const cardLast4 = pickLast4(cards as any);
      if (cardLast4) return { connected: true, last4: cardLast4, object: 'card' };

      return { connected: true, last4: null, object: null };
    }

    const agency = await this.agencyRepository.findOne({ where: { id: params.user.userId } });
    if (agency) {
      if (!agency.stripeConnectedAccountId) {
        return { connected: false, last4: null, object: null };
      }

      const accountId = agency.stripeConnectedAccountId;
      const bankAccounts = await stripe.accounts.listExternalAccounts(accountId, {
        object: 'bank_account',
        limit: 10,
      });

      const bankLast4 = pickLast4(bankAccounts as any);
      if (bankLast4) return { connected: true, last4: bankLast4, object: 'bank_account' };

      const cards = await stripe.accounts.listExternalAccounts(accountId, {
        object: 'card',
        limit: 10,
      });

      const cardLast4 = pickLast4(cards as any);
      if (cardLast4) return { connected: true, last4: cardLast4, object: 'card' };

      return { connected: true, last4: null, object: null };
    }

    throw new BadRequestException('User not found');
  }

  async createTopupPaymentIntent(params: {
    user: { userId: string; activeRole?: string };
    amountCents: number;
    referenceType: string;
    referenceId: string;
    idempotencyKey: string;
  }) {
    const amountCents = this.toIntCents(params.amountCents, 'amountCents');
    const currency = this.stripeService.getCurrency().toLowerCase();

    if (!params.idempotencyKey) {
      throw new BadRequestException('Missing idempotencyKey');
    }

    const stripe = this.stripeService.getClient();
    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: amountCents,
        currency,
        automatic_payment_methods: { enabled: true },
        metadata: {
          flow: 'topup',
          pilgrimUserId: params.user.userId,
          referenceType: String(params.referenceType || ''),
          referenceId: String(params.referenceId || ''),
          amountCents: String(amountCents),
        },
      },
      { idempotencyKey: params.idempotencyKey },
    );

    return {
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
    };
  }

  async createDirectPaymentIntent(params: {
    user: { userId: string; activeRole?: string };
    amountCents: number;
    recipientType: 'GUIDE' | 'AGENCY';
    recipientId: string;
    referenceType: string;
    referenceId: string;
    idempotencyKey: string;
  }) {
    const amountCents = this.toIntCents(params.amountCents, 'amountCents');
    const currency = this.stripeService.getCurrency().toLowerCase();

    if (!params.idempotencyKey) {
      throw new BadRequestException('Missing idempotencyKey');
    }

    const commissionRate = this.stripeService.getPlatformCommissionRate();
    const commissionAmountCents = Math.round((amountCents * commissionRate) / 100);

    const destinationAccountId = await this.getConnectedAccountId({
      recipientType: params.recipientType,
      recipientId: params.recipientId,
    });

    const stripe = this.stripeService.getClient();
    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: amountCents,
        currency,
        automatic_payment_methods: { enabled: true },
        application_fee_amount: commissionAmountCents,
        transfer_data: {
          destination: destinationAccountId,
        },
        metadata: {
          flow: 'direct_payment',
          payerUserId: params.user.userId,
          recipientType: params.recipientType,
          recipientId: params.recipientId,
          referenceType: String(params.referenceType || ''),
          referenceId: String(params.referenceId || ''),
          amountCents: String(amountCents),
          commissionAmountCents: String(commissionAmountCents),
        },
      },
      { idempotencyKey: params.idempotencyKey },
    );

    return {
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      commissionAmountCents,
    };
  }

  async createWalletPaymentTransfer(params: {
    user: { userId: string; activeRole?: string };
    totalAmountCents: number;
    recipientType: 'GUIDE' | 'AGENCY';
    recipientId: string;
    referenceType: string;
    referenceId: string;
    idempotencyKey: string;
  }) {
    const totalAmountCents = this.toIntCents(params.totalAmountCents, 'totalAmountCents');

    const commissionRate = this.stripeService.getPlatformCommissionRate();
    const commissionAmountCents = Math.round((totalAmountCents * commissionRate) / 100);
    const netAmountCents = totalAmountCents - commissionAmountCents;
    if (netAmountCents <= 0) {
      throw new BadRequestException('Invalid net amount');
    }

    const destinationAccountId = await this.getConnectedAccountId({
      recipientType: params.recipientType,
      recipientId: params.recipientId,
    });

    const pilgrimWallet = await this.walletService.getOrCreateWallet({
      ownerType: WalletOwnerType.PILGRIM,
      ownerId: params.user.userId,
      currency: 'MAD',
    });

    if (pilgrimWallet.availableBalance < totalAmountCents) {
      throw new BadRequestException('Insufficient wallet balance');
    }

    const stripe = this.stripeService.getClient();
    const transfer = await stripe.transfers.create(
      {
        amount: netAmountCents,
        currency: this.stripeService.getCurrency().toLowerCase(),
        destination: destinationAccountId,
        metadata: {
          flow: 'wallet_payment',
          pilgrimUserId: params.user.userId,
          recipientType: params.recipientType,
          recipientId: params.recipientId,
          referenceType: String(params.referenceType || ''),
          referenceId: String(params.referenceId || ''),
          totalAmountCents: String(totalAmountCents),
          commissionAmountCents: String(commissionAmountCents),
        },
      },
      { idempotencyKey: params.idempotencyKey },
    );

    return {
      transferId: transfer.id,
      netAmountCents,
      commissionAmountCents,
    };
  }

  async createConnectOnboardingLink(params: {
    user: { userId: string; activeRole?: string };
    ownerType: 'GUIDE' | 'AGENCY';
  }) {
    const isValidHttpUrl = (value: string) => {
      try {
        const u = new URL(value);
        return u.protocol === 'http:' || u.protocol === 'https:';
      } catch {
        return false;
      }
    };

    const refreshUrlRaw = process.env.STRIPE_CONNECT_REFRESH_URL || '';
    const returnUrlRaw = process.env.STRIPE_CONNECT_RETURN_URL || '';

    const refreshUrl = isValidHttpUrl(refreshUrlRaw) ? refreshUrlRaw : 'https://example.com/refresh';
    const returnUrl = isValidHttpUrl(returnUrlRaw) ? returnUrlRaw : 'https://example.com/return';

    const stripe = this.stripeService.getClient();

    if (params.ownerType === 'GUIDE') {
      const guide = await this.guideRepository.findOne({ where: { id: params.user.userId } });
      if (!guide) throw new BadRequestException('Guide not found');

      if (!guide.stripeConnectedAccountId) {
        const account = await stripe.accounts.create({
          type: 'express',
          country: 'US',
          capabilities: {
            transfers: { requested: true },
          },
          business_type: 'individual',
          metadata: {
            ownerType: 'GUIDE',
            ownerId: guide.id,
          },
        });
        guide.stripeConnectedAccountId = account.id;
        await this.guideRepository.save(guide);
      }

      const link = await stripe.accountLinks.create({
        account: guide.stripeConnectedAccountId,
        refresh_url: refreshUrl,
        return_url: returnUrl,
        type: 'account_onboarding',
      });

      return { url: link.url, stripeConnectedAccountId: guide.stripeConnectedAccountId };
    }

    if (params.ownerType === 'AGENCY') {
      // Similar logic for agencies
      throw new BadRequestException('Agency Connect not implemented yet');
    }

    throw new BadRequestException('Invalid ownerType');
  }

  async createStripeConnectAccountForOwner(params: {
    ownerType: 'GUIDE' | 'AGENCY';
    ownerId: string;
  }): Promise<{ accountId: string | null; error: string | null }> {
    const stripe = this.stripeService.getClient();
    try {
      let owner: Guide | AdminAgenceUser | null = null;
      if (params.ownerType === 'GUIDE') {
        owner = await this.guideRepository.findOne({ where: { id: params.ownerId } });
      } else if (params.ownerType === 'AGENCY') {
        owner = await this.agencyRepository.findOne({ where: { id: params.ownerId } });
      }
      if (!owner) return { accountId: null, error: 'Owner not found' };
      if (owner.stripeConnectedAccountId) return { accountId: owner.stripeConnectedAccountId, error: null };

      const account = await stripe.accounts.create({
        type: 'express',
        country: 'US',
        capabilities: {
          transfers: { requested: true },
        },
        business_type: params.ownerType === 'AGENCY' ? 'company' : 'individual',
        metadata: {
          ownerType: params.ownerType,
          ownerId: params.ownerId,
        },
      });
      owner.stripeConnectedAccountId = account.id;
      if (params.ownerType === 'GUIDE') {
        await this.guideRepository.save(owner as Guide);
      } else {
        await this.agencyRepository.save(owner as AdminAgenceUser);
      }
      return { accountId: account.id, error: null };
    } catch (e: any) {
      this.logger.error(`Failed to create Stripe Connect account for ${params.ownerType} ${params.ownerId}: ${String(e?.message || e)}`);
      return { accountId: null, error: String(e?.message || e) };
    }
  }
}
