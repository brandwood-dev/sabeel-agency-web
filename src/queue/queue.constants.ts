export const DOMAIN_SIDE_EFFECTS_QUEUE = 'domain-side-effects';
export const DOMAIN_SIDE_EFFECTS_DLQ_QUEUE = 'domain-side-effects-dlq';

export const DOMAIN_SIDE_EFFECTS_JOB = {
  STRIPE_DOMAIN_EVENT: 'stripe-domain-event',
} as const;

export const DOMAIN_SIDE_EFFECTS_DLQ_JOB = {
  FAILED_SIDE_EFFECT: 'failed-side-effect',
} as const;
