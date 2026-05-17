export type BaseDomainEventPayload = {
  eventName?: string;
  stripeEventId: string;
  stripeType: string;
  objectId?: string | null;
  amount?: number | null;
  currency?: string | null;
  status?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  fromWalletId?: string | null;
  toWalletId?: string | null;
  walletTransactionIds?: string[];
  metadata?: any;
  occurredAt: string;
};
