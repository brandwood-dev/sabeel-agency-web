import { BadRequestException, Controller, Headers, Post, Req } from '@nestjs/common';
import Stripe from 'stripe';
import { StripeService } from './stripe.service';
import { StripeWebhookService } from './stripe-webhook.service';

@Controller('stripe')
export class StripeController {
  constructor(
    private readonly stripeService: StripeService,
    private readonly stripeWebhookService: StripeWebhookService,
  ) {}

  @Post('webhook')
  async webhook(@Req() req: any, @Headers('stripe-signature') signature?: string) {
    const webhookSecret = this.stripeService.getWebhookSecret();
    if (!webhookSecret) {
      throw new BadRequestException('Missing STRIPE_WEBHOOK_SECRET');
    }

    if (!signature) {
      throw new BadRequestException('Missing stripe-signature header');
    }

    const rawBody: Buffer = req.body;
    if (!Buffer.isBuffer(rawBody)) {
      throw new BadRequestException('Webhook body must be raw buffer');
    }

    let event: any;
    try {
      const stripe = this.stripeService.getClient();
      event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch (err: any) {
      throw new BadRequestException(`Webhook signature verification failed: ${String(err?.message || err)}`);
    }

    const result = await this.stripeWebhookService.recordAndDispatch(event);
    return { received: true, ...result };
  }
}
