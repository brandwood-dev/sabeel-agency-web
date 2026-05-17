import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { QueueProvider } from '../../queue/queue.provider';
import { DOMAIN_SIDE_EFFECTS_JOB } from '../../queue/queue.constants';
import { STRIPE_DOMAIN_EVENTS } from './stripe-domain-events';
import type { BaseDomainEventPayload } from './stripe-domain-event.types';

@Injectable()
export class StripeDomainEventsListener {
  private readonly logger = new Logger(StripeDomainEventsListener.name);

  constructor(
    private readonly queueProvider: QueueProvider,
  ) {}

  private enqueue(payload: BaseDomainEventPayload) {
    const eventName = payload?.eventName ? String(payload.eventName) : '';
    const stripeEventId = payload?.stripeEventId ? String(payload.stripeEventId) : '';
    const jobId = eventName && stripeEventId ? `${eventName}:${stripeEventId}` : undefined;

    Promise.resolve()
      .then(async () => {
        await this.queueProvider.domainSideEffectsQueue?.add(
          DOMAIN_SIDE_EFFECTS_JOB.STRIPE_DOMAIN_EVENT,
          { payload },
          {
            jobId,
            attempts: 8,
            backoff: { type: 'exponential', delay: 5000 },
            removeOnComplete: { age: 60 * 60 * 24 * 7, count: 10000 },
            removeOnFail: { age: 60 * 60 * 24 * 14, count: 10000 },
          },
        );
      })
      .catch((e: any) => {
        this.logger.error(
          JSON.stringify({
            msg: 'domain_event_enqueue_error',
            eventName: payload?.eventName,
            stripeEventId: payload?.stripeEventId,
            jobId,
            error: String(e?.message || e),
          }),
        );
      });
  }

  @OnEvent(STRIPE_DOMAIN_EVENTS.WALLET_TOPUP_SUCCEEDED)
  async onWalletTopupSucceeded(payload: BaseDomainEventPayload) {
    try {
      this.logger.log(
        JSON.stringify({ msg: 'domain_event', name: STRIPE_DOMAIN_EVENTS.WALLET_TOPUP_SUCCEEDED, payload }),
      );

      this.enqueue(payload);
    } catch (e: any) {
      this.logger.error(
        JSON.stringify({
          msg: 'domain_event_error',
          name: STRIPE_DOMAIN_EVENTS.WALLET_TOPUP_SUCCEEDED,
          error: String(e?.message || e),
        }),
      );
    }
  }

  @OnEvent(STRIPE_DOMAIN_EVENTS.PAYMENT_DIRECT_COMPLETED)
  async onPaymentDirectCompleted(payload: BaseDomainEventPayload) {
    try {
      this.logger.log(JSON.stringify({ msg: 'domain_event', name: STRIPE_DOMAIN_EVENTS.PAYMENT_DIRECT_COMPLETED, payload }));

      this.enqueue(payload);
    } catch (e: any) {
      this.logger.error(JSON.stringify({ msg: 'domain_event_error', name: STRIPE_DOMAIN_EVENTS.PAYMENT_DIRECT_COMPLETED, error: String(e?.message || e) }));
    }
  }

  @OnEvent(STRIPE_DOMAIN_EVENTS.PAYMENT_WALLET_COMPLETED)
  async onPaymentWalletCompleted(payload: BaseDomainEventPayload) {
    try {
      this.logger.log(JSON.stringify({ msg: 'domain_event', name: STRIPE_DOMAIN_EVENTS.PAYMENT_WALLET_COMPLETED, payload }));

      this.enqueue(payload);
    } catch (e: any) {
      this.logger.error(JSON.stringify({ msg: 'domain_event_error', name: STRIPE_DOMAIN_EVENTS.PAYMENT_WALLET_COMPLETED, error: String(e?.message || e) }));
    }
  }

  @OnEvent(STRIPE_DOMAIN_EVENTS.WITHDRAWAL_REQUESTED)
  async onWithdrawalRequested(payload: BaseDomainEventPayload) {
    try {
      this.logger.log(JSON.stringify({ msg: 'domain_event', name: STRIPE_DOMAIN_EVENTS.WITHDRAWAL_REQUESTED, payload }));
    } catch (e: any) {
      this.logger.error(JSON.stringify({ msg: 'domain_event_error', name: STRIPE_DOMAIN_EVENTS.WITHDRAWAL_REQUESTED, error: String(e?.message || e) }));
    }
  }

  @OnEvent(STRIPE_DOMAIN_EVENTS.WITHDRAWAL_PAID)
  async onWithdrawalPaid(payload: BaseDomainEventPayload) {
    try {
      this.logger.log(JSON.stringify({ msg: 'domain_event', name: STRIPE_DOMAIN_EVENTS.WITHDRAWAL_PAID, payload }));

      this.enqueue(payload);
    } catch (e: any) {
      this.logger.error(JSON.stringify({ msg: 'domain_event_error', name: STRIPE_DOMAIN_EVENTS.WITHDRAWAL_PAID, error: String(e?.message || e) }));
    }
  }

  @OnEvent(STRIPE_DOMAIN_EVENTS.WITHDRAWAL_FAILED)
  async onWithdrawalFailed(payload: BaseDomainEventPayload) {
    try {
      this.logger.log(JSON.stringify({ msg: 'domain_event', name: STRIPE_DOMAIN_EVENTS.WITHDRAWAL_FAILED, payload }));

      this.enqueue(payload);
    } catch (e: any) {
      this.logger.error(
        JSON.stringify({ msg: 'domain_event_error', name: STRIPE_DOMAIN_EVENTS.WITHDRAWAL_FAILED, error: String(e?.message || e) }),
      );
    }
  }

  @OnEvent(STRIPE_DOMAIN_EVENTS.REFUND_COMPLETED)
  async onRefundCompleted(payload: BaseDomainEventPayload) {
    try {
      this.logger.log(JSON.stringify({ msg: 'domain_event', name: STRIPE_DOMAIN_EVENTS.REFUND_COMPLETED, payload }));

      this.enqueue(payload);
    } catch (e: any) {
      this.logger.error(JSON.stringify({ msg: 'domain_event_error', name: STRIPE_DOMAIN_EVENTS.REFUND_COMPLETED, error: String(e?.message || e) }));
    }
  }
}
