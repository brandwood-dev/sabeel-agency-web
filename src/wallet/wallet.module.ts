import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Wallet } from './entities/wallet.entity';
import { WalletTransaction } from './entities/wallet-transaction.entity';
import { WithdrawalRequest } from './entities/withdrawal-request.entity';
import { WalletAuditLog } from './entities/wallet-audit-log.entity';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';
import { WithdrawalCronService } from './withdrawal-cron.service';
import { StripeModule } from '../stripe/stripe.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Wallet, WalletTransaction, WithdrawalRequest, WalletAuditLog]),
    forwardRef(() => StripeModule),
  ],
  controllers: [WalletController],
  providers: [WalletService, WithdrawalCronService],
  exports: [WalletService],
})
export class WalletModule {}
