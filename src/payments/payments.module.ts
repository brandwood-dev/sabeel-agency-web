import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule } from '../common/common.module';
import { StripeModule } from '../stripe/stripe.module';
import { WalletModule } from '../wallet/wallet.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { Guide } from '../sabeel-guide/auth/entities/guide.entity';
import { AdminAgenceUser } from '../admin_agence/auth/entities/admin-agence-user.entity';

@Module({
  imports: [
    CommonModule,
    StripeModule,
    WalletModule,
    TypeOrmModule.forFeature([Guide, AdminAgenceUser]),
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
