import { Injectable } from '@nestjs/common';
import {
  Counter,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';

@Injectable()
export class ObservabilityService {
  private readonly registry = new Registry();

  readonly stripeWebhookProcessedTotal: Counter;
  readonly stripeWebhookDurationMs: Histogram;

  readonly walletBalanceDeltaTotal: Counter;
  readonly walletBalanceDeltaDurationMs: Histogram;

  readonly sideEffectJobsTotal: Counter;
  readonly sideEffectJobDurationMs: Histogram;

  constructor() {
    collectDefaultMetrics({ register: this.registry });

    this.stripeWebhookProcessedTotal = new Counter({
      name: 'sabeel_stripe_webhook_processed_total',
      help: 'Total number of Stripe webhook events processed',
      labelNames: ['stripe_type', 'flow', 'result'],
      registers: [this.registry],
    });

    this.stripeWebhookDurationMs = new Histogram({
      name: 'sabeel_stripe_webhook_duration_ms',
      help: 'Stripe webhook processing duration (ms)',
      labelNames: ['stripe_type', 'flow'],
      buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
      registers: [this.registry],
    });

    this.walletBalanceDeltaTotal = new Counter({
      name: 'sabeel_wallet_balance_delta_total',
      help: 'Total number of wallet balance delta operations',
      labelNames: ['result'],
      registers: [this.registry],
    });

    this.walletBalanceDeltaDurationMs = new Histogram({
      name: 'sabeel_wallet_balance_delta_duration_ms',
      help: 'Duration of wallet balance delta operations (ms)',
      labelNames: ['result'],
      buckets: [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000],
      registers: [this.registry],
    });

    this.sideEffectJobsTotal = new Counter({
      name: 'sabeel_side_effect_jobs_total',
      help: 'Total side effect jobs processed by worker',
      labelNames: ['job_name', 'event_name', 'result'],
      registers: [this.registry],
    });

    this.sideEffectJobDurationMs = new Histogram({
      name: 'sabeel_side_effect_job_duration_ms',
      help: 'Side effect job processing duration (ms)',
      labelNames: ['job_name', 'event_name'],
      buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
      registers: [this.registry],
    });
  }

  getRegistry() {
    return this.registry;
  }

  async getMetricsText() {
    return this.registry.metrics();
  }
}
