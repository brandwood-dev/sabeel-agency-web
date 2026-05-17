export const STRIPE_DOMAIN_EVENTS = {
  WALLET_TOPUP_SUCCEEDED: 'wallet.topup.succeeded',
  PAYMENT_DIRECT_COMPLETED: 'payment.direct.completed',
  PAYMENT_WALLET_COMPLETED: 'payment.wallet.completed',
  WITHDRAWAL_REQUESTED: 'withdrawal.requested',
  WITHDRAWAL_PAID: 'withdrawal.paid',
  WITHDRAWAL_FAILED: 'withdrawal.failed',
  REFUND_COMPLETED: 'refund.completed',
} as const;

export type StripeDomainEventName = (typeof STRIPE_DOMAIN_EVENTS)[keyof typeof STRIPE_DOMAIN_EVENTS];
