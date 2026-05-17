import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MailerModule } from '@nestjs-modules/mailer';
import { WalletModule } from '../wallet/wallet.module';
import { StripeWebhookEvent } from './entities/stripe-webhook-event.entity';
import { StripeController } from './stripe.controller';
import { StripeService } from './stripe.service';
import { StripeWebhookService } from './stripe-webhook.service';
import { StripeDomainEventsListener } from './domain-events/stripe-domain-events.listener';
import { StripeRetentionService } from './stripe-retention.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([StripeWebhookEvent]),
    forwardRef(() => WalletModule),
    MailerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ({
        transport: {
          host: configService.get<string>('MAIL_HOST') || 'smtp.gmail.com',
          port: configService.get<number>('MAIL_PORT') || 587,
          secure: false,
          auth: {
            user: configService.get<string>('MAIL_USER'),
            pass: configService.get<string>('MAIL_PASS')?.replace(/\s+/g, ''),
          },
        },
        defaults: {
          from: `"${configService.get<string>('MAIL_FROM_NAME') || 'Sabeel'}" <${configService.get<string>('MAIL_FROM') || 'noreply@sabeel.com'}>`,
        },
      }),
    }),
  ],
  controllers: [StripeController],
  providers: [StripeService, StripeWebhookService, StripeDomainEventsListener, StripeRetentionService],
  exports: [StripeService, StripeWebhookService],
})
export class StripeModule {}
