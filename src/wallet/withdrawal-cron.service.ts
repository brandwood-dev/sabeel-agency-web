import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { StripeService } from '../stripe/stripe.service';
import { WithdrawalRequest, WithdrawalRequestStatus } from './entities/withdrawal-request.entity';
import { Wallet } from './entities/wallet.entity';
import { WalletService } from './wallet.service';
import { Guide } from '../sabeel-guide/auth/entities/guide.entity';
import { AdminAgenceUser } from '../admin_agence/auth/entities/admin-agence-user.entity';

@Injectable()
export class WithdrawalCronService {
  private readonly logger = new Logger(WithdrawalCronService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly stripeService: StripeService,
    private readonly walletService: WalletService,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async processScheduledWithdrawals() {
    const now = new Date();

    try {
      const stripe = this.stripeService.getClient();
      const currency = this.stripeService.getCurrency().toLowerCase();

      const batchSize = 20;

      await this.dataSource.transaction(async (manager) => {
        const wrRepo = manager.getRepository(WithdrawalRequest);

        const due = await wrRepo.find({
          where: { status: WithdrawalRequestStatus.SCHEDULED } as any,
          order: { processableAt: 'ASC' } as any,
          take: batchSize,
        });

        for (const req of due) {
          if (req.processableAt > now) continue;

          // lock row
          const locked = await wrRepo.findOne({
            where: { id: req.id } as any,
            lock: { mode: 'pessimistic_write' },
          });
          if (!locked) continue;
          if (locked.status !== WithdrawalRequestStatus.SCHEDULED) continue;

          locked.status = WithdrawalRequestStatus.PROCESSING;
          await wrRepo.save(locked);

          // Determine connected account from wallet owner
          const wallet = await manager.getRepository(Wallet).findOne({ where: { id: locked.walletId } });
          if (!wallet) {
            locked.status = WithdrawalRequestStatus.FAILED;
            locked.failureReason = 'wallet_not_found';
            await wrRepo.save(locked);
            continue;
          }

          let connectedAccountId: string | null = null;
          if (wallet.ownerType === 'GUIDE') {
            const guide = await manager.getRepository(Guide).findOne({ where: { id: wallet.ownerId } as any });
            connectedAccountId = guide?.stripeConnectedAccountId || null;
          } else if (wallet.ownerType === 'AGENCY') {
            const agency = await manager
              .getRepository(AdminAgenceUser)
              .findOne({ where: { id: wallet.ownerId } as any });
            connectedAccountId = agency?.stripeConnectedAccountId || null;
          }

          if (!connectedAccountId) {
            locked.status = WithdrawalRequestStatus.FAILED;
            locked.failureReason = 'missing_connected_account';
            await wrRepo.save(locked);

            // Revert pending -> available to avoid funds being stuck
            await this.walletService.applyBalanceDeltaInTransaction(manager, {
              walletId: locked.walletId,
              availableDelta: locked.amount,
              pendingDelta: -locked.amount,
              auditMessage: 'Withdrawal failed - no connected account (reverted)',
              auditData: { withdrawalRequestId: locked.id },
            });

            continue;
          }

          try {
            // If needed, transfer funds from platform to connected account before payout
            let transferId: string | null = null;
            try {
              const transfer = await stripe.transfers.create(
                {
                  amount: locked.amount,
                  currency,
                  destination: connectedAccountId,
                  metadata: {
                    flow: 'withdrawal',
                    withdrawalRequestId: locked.id,
                    walletId: locked.walletId,
                  },
                },
                {
                  idempotencyKey: `withdrawal_transfer:${locked.id}`,
                },
              );
              transferId = transfer.id;
            } catch (transferErr: any) {
              // If transfer fails, we cannot proceed with payout
              locked.status = WithdrawalRequestStatus.FAILED;
              locked.failureReason = `Transfer failed: ${String(transferErr?.message || transferErr)}`;
              await wrRepo.save(locked);

              await this.walletService.applyBalanceDeltaInTransaction(manager, {
                walletId: locked.walletId,
                availableDelta: locked.amount,
                pendingDelta: -locked.amount,
                auditMessage: 'Withdrawal transfer creation failed (reverted)',
                auditData: { withdrawalRequestId: locked.id },
              });
              continue;
            }

            const payout = await stripe.payouts.create(
              {
                amount: locked.amount,
                currency,
                metadata: {
                  flow: 'withdrawal',
                  withdrawalRequestId: locked.id,
                  walletId: locked.walletId,
                  transferId,
                },
              },
              {
                idempotencyKey: `withdrawal_payout:${locked.id}`,
                stripeAccount: connectedAccountId,
              } as any,
            );

            locked.stripeTransferId = transferId;
            locked.stripePayoutId = payout.id;
            await wrRepo.save(locked);
          } catch (e: any) {
            locked.status = WithdrawalRequestStatus.FAILED;
            locked.failureReason = String(e?.message || e);
            await wrRepo.save(locked);

            await this.walletService.applyBalanceDeltaInTransaction(manager, {
              walletId: locked.walletId,
              availableDelta: locked.amount,
              pendingDelta: -locked.amount,
              auditMessage: 'Withdrawal payout creation failed (reverted)',
              auditData: { withdrawalRequestId: locked.id },
            });
          }
        }
      });
    } catch (e: any) {
      this.logger.error(
        JSON.stringify({
          msg: 'withdrawal_cron_error',
          error: String(e?.message || e),
        }),
      );
    }
  }
}
