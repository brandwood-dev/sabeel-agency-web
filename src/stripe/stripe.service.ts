import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private readonly stripe: InstanceType<typeof Stripe>;

  constructor(private readonly configService: ConfigService) {
    const secretKey = this.configService.get<string>('STRIPE_SECRET_KEY');
    if (!secretKey) {
      this.logger.error('STRIPE_SECRET_KEY is not set. Stripe operations will fail. Please add it to your .env file.');
    }

    // Allow Stripe to be instantiated but operations will fail without a key
    this.stripe = new Stripe(secretKey || '', {
      apiVersion: '2026-04-22.dahlia',
      typescript: true,
    });
  }

  getClient() {
    return this.stripe;
  }

  getWebhookSecret() {
    return this.configService.get<string>('STRIPE_WEBHOOK_SECRET') || '';
  }

  getCurrency() {
    return this.configService.get<string>('STRIPE_CURRENCY', 'MAD');
  }

  getPlatformCommissionRate() {
    const value = Number(this.configService.get<string>('STRIPE_PLATFORM_COMMISSION_RATE', '5'));
    return Number.isFinite(value) ? value : 5;
  }

  getWithdrawDelayHours() {
    const value = Number(this.configService.get<string>('STRIPE_WITHDRAW_DELAY_HOURS', '48'));
    return Number.isFinite(value) ? value : 48;
  }
}
