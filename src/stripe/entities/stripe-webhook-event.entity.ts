import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('stripe_webhook_events')
@Index(['eventId'], { unique: true })
@Index(['type', 'createdAt'])
@Index(['objectId', 'createdAt'])
export class StripeWebhookEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  eventId: string;

  @Column({ type: 'text', nullable: true })
  type: string | null;

  @Column({ type: 'text', nullable: true })
  objectType: string | null;

  @Column({ type: 'text', nullable: true })
  objectId: string | null;

  @Column({ type: 'int', nullable: true })
  amount: number | null;

  @Column({ type: 'text', nullable: true })
  currency: string | null;

  @Column({ type: 'text', nullable: true })
  status: string | null;

  @Column({ type: 'text', nullable: true })
  customerId: string | null;

  @Column({ type: 'text', nullable: true })
  accountId: string | null;

  @Column({ type: 'text', nullable: true })
  paymentIntentId: string | null;

  @Column({ type: 'text', nullable: true })
  transferId: string | null;

  @Column({ type: 'text', nullable: true })
  payoutId: string | null;

  @Column({ type: 'text', nullable: true })
  refundId: string | null;

  @Column({ type: 'bigint', nullable: true })
  eventCreatedAtUnix: string | null;

  @Column({ type: 'text', nullable: true })
  apiVersion: string | null;

  @Column({ type: 'text', nullable: true })
  livemode: string | null;

  @Column({ type: 'jsonb', nullable: true })
  sanitizedPayload: any;

  @CreateDateColumn()
  createdAt: Date;
}
