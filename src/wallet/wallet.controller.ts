import { BadRequestException, Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { WalletService } from './wallet.service';
import { DataSource } from 'typeorm';
import { WithdrawalRequest, WithdrawalRequestStatus } from './entities/withdrawal-request.entity';
import { WalletTransactionType } from './entities/wallet-transaction.entity';

@Controller('wallet')
@UseGuards(JwtAuthGuard)
export class WalletController {
  constructor(
    private readonly walletService: WalletService,
    private readonly dataSource: DataSource,
  ) {}

  @Get('me')
  async getMe(@CurrentUser() user: { userId: string; activeRole?: string }) {
    const wallet = await this.walletService.getMyWallet(user);
    return {
      wallet,
    };
  }

  @Get('transactions')
  async listTransactions(
    @CurrentUser() user: { userId: string; activeRole?: string },
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.walletService.listMyTransactions(user, {
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  @Post('withdrawal/request')
  async requestWithdrawal(
    @CurrentUser() user: { userId: string; activeRole?: string },
    @Body() body: { amountCents: number; idempotencyKey: string },
  ) {
    if (!body?.idempotencyKey) {
      throw new BadRequestException('Missing idempotencyKey');
    }

    const amount = Number(body.amountCents);
    if (!Number.isFinite(amount) || Math.floor(amount) !== amount || amount <= 0) {
      throw new BadRequestException('Invalid amountCents');
    }

    const wallet = await this.walletService.getMyWallet(user);

    return this.dataSource.transaction(async (manager) => {
      const wrRepo = manager.getRepository(WithdrawalRequest);
      const existing = await wrRepo.findOne({ where: { idempotencyKey: body.idempotencyKey } as any });
      if (existing) {
        return { withdrawalRequest: existing };
      }

      // Move funds available -> pending (webhook will later finalize)
      await this.walletService.applyBalanceDeltaInTransaction(manager, {
        actorUserId: user.userId,
        actorRole: user.activeRole || null,
        walletId: wallet.id,
        availableDelta: -amount,
        pendingDelta: amount,
        auditMessage: 'Withdrawal requested (funds moved to pending)',
        auditData: { idempotencyKey: body.idempotencyKey },
      });

      const delayHours = Number(process.env.STRIPE_WITHDRAW_DELAY_HOURS || 48);
      const processableAt = new Date(Date.now() + Math.max(delayHours, 0) * 60 * 60 * 1000);

      const created = await wrRepo.save(
        wrRepo.create({
          walletId: wallet.id,
          amount,
          currency: wallet.currency,
          status: WithdrawalRequestStatus.SCHEDULED,
          processableAt,
          idempotencyKey: body.idempotencyKey,
          stripePayoutId: null,
          stripeTransferId: null,
          failureReason: null,
        }),
      );

      await this.walletService.createWalletTransactionInTransaction(manager, {
        type: WalletTransactionType.WITHDRAWAL_REQUEST,
        amount,
        currency: wallet.currency,
        fromWalletId: wallet.id,
        toWalletId: null,
        stripeObjectType: null,
        stripeObjectId: null,
        stripeEventId: null,
        referenceType: 'withdrawal',
        referenceId: created.id,
        metadata: { idempotencyKey: body.idempotencyKey },
        idempotencyKey: `withdrawal_request:${wallet.id}:${body.idempotencyKey}`,
      });

      return { withdrawalRequest: created };
    });
  }
}
