import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Wallet, WalletOwnerType } from './entities/wallet.entity';
import {
  StripeObjectType,
  WalletTransaction,
  WalletTransactionStatus,
  WalletTransactionType,
} from './entities/wallet-transaction.entity';
import { WalletAuditAction, WalletAuditLog } from './entities/wallet-audit-log.entity';
import { ObservabilityService } from '../observability/observability.service';

@Injectable()
export class WalletService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly observability: ObservabilityService,
    @InjectRepository(Wallet)
    private readonly walletRepository: Repository<Wallet>,
    @InjectRepository(WalletTransaction)
    private readonly transactionRepository: Repository<WalletTransaction>,
    @InjectRepository(WalletAuditLog)
    private readonly auditRepository: Repository<WalletAuditLog>,
  ) {}

  private async createAuditLog(params: {
    actorUserId?: string | null;
    actorRole?: string | null;
    walletId?: string | null;
    action: WalletAuditAction;
    message?: string | null;
    data?: any;
  }) {
    const row = this.auditRepository.create({
      actorUserId: params.actorUserId ?? null,
      actorRole: params.actorRole ?? null,
      walletId: params.walletId ?? null,
      action: params.action,
      message: params.message ?? null,
      data: params.data ?? null,
    });
    await this.auditRepository.save(row);
  }

  private mapOwnerType(activeRole?: string): WalletOwnerType {
    const role = String(activeRole || '').toLowerCase();
    console.log('mapOwnerType input:', { activeRole, role });

    if (role === 'pelerin' || role === 'accompagnant') {
      console.log('Mapping to PILGRIM');
      return WalletOwnerType.PILGRIM;
    }

    if (role === 'freelance' || role === 'guide' || role === 'agency') {
      console.log('Mapping to GUIDE');
      return WalletOwnerType.GUIDE;
    }

    if (role === 'agence' || role === 'admin' || role === 'sub_admin') {
      console.log('Mapping to AGENCY');
      return WalletOwnerType.AGENCY;
    }

    console.log('No matching role found, throwing error');
    throw new BadRequestException(`Unsupported role for wallet: ${activeRole}`);
  }

  async getOrCreateWallet(params: {
    ownerType: WalletOwnerType;
    ownerId: string;
    currency?: string;
  }) {
    const currency = params.currency || 'MAD';

    return this.dataSource.transaction(async (manager) => {
      const existing = await manager.getRepository(Wallet).findOne({
        where: {
          ownerType: params.ownerType,
          ownerId: params.ownerId,
        },
      });

      if (existing) return existing;

      const created = manager.getRepository(Wallet).create({
        ownerType: params.ownerType,
        ownerId: params.ownerId,
        currency,
        availableBalance: 0,
        pendingBalance: 0,
      });

      try {
        const saved = await manager.getRepository(Wallet).save(created);
        await manager.getRepository(WalletAuditLog).save(
          manager.getRepository(WalletAuditLog).create({
            actorUserId: params.ownerId,
            actorRole: null,
            walletId: saved.id,
            action: WalletAuditAction.WALLET_CREATED,
            message: 'Wallet created',
            data: {
              ownerType: params.ownerType,
              currency,
            },
          }),
        );
        return saved;
      } catch {
        // Concurrency-safe: in case of unique conflict, re-read.
        const reread = await manager.getRepository(Wallet).findOne({
          where: {
            ownerType: params.ownerType,
            ownerId: params.ownerId,
          },
        });
        if (reread) return reread;
        throw new BadRequestException('Failed to create wallet');
      }
    });
  }

  async getMyWallet(currentUser: { userId: string; activeRole?: string }) {
    console.log('getMyWallet called with user:', { userId: currentUser.userId, activeRole: currentUser.activeRole });
    try {
      const ownerType = this.mapOwnerType(currentUser.activeRole);
      console.log('Mapped ownerType:', ownerType);
      return this.getOrCreateWallet({ ownerType, ownerId: currentUser.userId, currency: 'MAD' });
    } catch (err) {
      console.error('Error mapping owner type:', err);
      // Fallback: treat as GUIDE if role is missing or invalid
      return this.getOrCreateWallet({ ownerType: WalletOwnerType.GUIDE, ownerId: currentUser.userId, currency: 'MAD' });
    }
  }

  async listMyTransactions(
    currentUser: { userId: string; activeRole?: string },
    params: { limit?: number; offset?: number },
  ) {
    const wallet = await this.getMyWallet(currentUser);

    const limit = Math.min(Math.max(Number(params.limit || 20), 1), 100);
    const offset = Math.max(Number(params.offset || 0), 0);

    const [items, total] = await this.transactionRepository.findAndCount({
      where: [{ fromWalletId: wallet.id }, { toWalletId: wallet.id }],
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    return {
      walletId: wallet.id,
      currency: wallet.currency,
      total,
      limit,
      offset,
      items,
    };
  }

  /**
   * Atomic balance update helper.
   * Must be called inside a DB transaction.
   */
  private async lockWalletForUpdate(manager: any, walletId: string) {
    const repo = manager.getRepository(Wallet);
    const wallet = await repo.findOne({
      where: { id: walletId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!wallet) {
      throw new BadRequestException('Wallet not found');
    }
    return wallet;
  }

  async applyBalanceDeltaInTransaction(
    manager: any,
    params: {
      actorUserId?: string | null;
      actorRole?: string | null;
      walletId: string;
      availableDelta?: number;
      pendingDelta?: number;
      auditMessage: string;
      auditData?: any;
    },
  ) {
    const startedAt = Date.now();
    const availableDelta = Number(params.availableDelta || 0);
    const pendingDelta = Number(params.pendingDelta || 0);

    let resultLabel: 'ok' | 'error' = 'ok';
    try {
      const wallet = await this.lockWalletForUpdate(manager, params.walletId);

      const nextAvailable = wallet.availableBalance + availableDelta;
      const nextPending = wallet.pendingBalance + pendingDelta;
      if (nextAvailable < 0 || nextPending < 0) {
        throw new BadRequestException('Insufficient wallet balance');
      }

      wallet.availableBalance = nextAvailable;
      wallet.pendingBalance = nextPending;
      const saved = await manager.getRepository(Wallet).save(wallet);

      await manager.getRepository(WalletAuditLog).save(
        manager.getRepository(WalletAuditLog).create({
          actorUserId: params.actorUserId ?? null,
          actorRole: params.actorRole ?? null,
          walletId: saved.id,
          action: WalletAuditAction.BALANCE_UPDATED,
          message: params.auditMessage,
          data: {
            availableDelta,
            pendingDelta,
            availableBalance: saved.availableBalance,
            pendingBalance: saved.pendingBalance,
            ...(params.auditData || {}),
          },
        }),
      );

      return saved;
    } catch (e) {
      resultLabel = 'error';
      throw e;
    } finally {
      const durationMs = Date.now() - startedAt;
      try {
        this.observability.walletBalanceDeltaTotal.inc({ result: resultLabel });
        this.observability.walletBalanceDeltaDurationMs.observe({ result: resultLabel }, durationMs);
      } catch {
        // ignore
      }
    }
  }

  async applyBalanceDelta(params: {
    actorUserId?: string | null;
    actorRole?: string | null;
    walletId: string;
    availableDelta?: number;
    pendingDelta?: number;
    auditMessage: string;
    auditData?: any;
  }) {
    return this.dataSource.transaction(async (manager) => {
      return this.applyBalanceDeltaInTransaction(manager, params);
    });
  }

  async createWalletTransactionInTransaction(
    manager: any,
    params: {
      type: WalletTransactionType;
      status?: WalletTransactionStatus;
      amount: number;
      currency?: string;
      fromWalletId?: string | null;
      toWalletId?: string | null;
      stripeObjectType?: StripeObjectType | null;
      stripeObjectId?: string | null;
      stripeEventId?: string | null;
      referenceType?: string | null;
      referenceId?: string | null;
      metadata?: any;
      idempotencyKey: string;
    },
  ) {
    const repo = manager.getRepository(WalletTransaction);

    const existing = await repo.findOne({ where: { idempotencyKey: params.idempotencyKey } });
    if (existing) return existing;

    const created = repo.create({
      type: params.type,
      status: params.status || WalletTransactionStatus.SUCCEEDED,
      amount: params.amount,
      currency: params.currency || 'MAD',
      fromWalletId: params.fromWalletId ?? null,
      toWalletId: params.toWalletId ?? null,
      stripeObjectType: params.stripeObjectType ?? null,
      stripeObjectId: params.stripeObjectId ?? null,
      stripeEventId: params.stripeEventId ?? null,
      referenceType: params.referenceType ?? null,
      referenceId: params.referenceId ?? null,
      metadata: params.metadata ?? null,
      idempotencyKey: params.idempotencyKey,
    });

    return repo.save(created);
  }
}
