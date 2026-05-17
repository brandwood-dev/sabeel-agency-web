import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Wallet } from './wallet.entity';

export enum WalletTransactionType {
  TOPUP = 'TOPUP',
  PAYMENT = 'PAYMENT',
  COMMISSION = 'COMMISSION',
  EARNING = 'EARNING',
  WITHDRAWAL_REQUEST = 'WITHDRAWAL_REQUEST',
  WITHDRAWAL_PAID = 'WITHDRAWAL_PAID',
  REFUND = 'REFUND',
  ADJUSTMENT = 'ADJUSTMENT',
}

export enum WalletTransactionStatus {
  PENDING = 'PENDING',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
  CANCELED = 'CANCELED',
}

export enum StripeObjectType {
  PAYMENT_INTENT = 'PAYMENT_INTENT',
  TRANSFER = 'TRANSFER',
  PAYOUT = 'PAYOUT',
  REFUND = 'REFUND',
}

@Entity('wallet_transactions')
@Index(['idempotencyKey'], { unique: true })
@Index(['fromWalletId', 'createdAt'])
@Index(['toWalletId', 'createdAt'])
@Index(['stripeObjectType', 'stripeObjectId'])
@Index(['referenceType', 'referenceId'])
@Index(['stripeEventId', 'createdAt'])
export class WalletTransaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'enum',
    enum: WalletTransactionType,
  })
  type: WalletTransactionType;

  @Column({
    type: 'enum',
    enum: WalletTransactionStatus,
    default: WalletTransactionStatus.PENDING,
  })
  status: WalletTransactionStatus;

  @Column({ type: 'int' })
  amount: number;

  @Column({ default: 'MAD' })
  currency: string;

  @Column({ type: 'uuid', nullable: true })
  fromWalletId: string | null;

  @Column({ type: 'uuid', nullable: true })
  toWalletId: string | null;

  @ManyToOne(() => Wallet, { nullable: true })
  fromWallet: Wallet | null;

  @ManyToOne(() => Wallet, { nullable: true })
  toWallet: Wallet | null;

  @Column({
    type: 'enum',
    enum: StripeObjectType,
    nullable: true,
  })
  stripeObjectType: StripeObjectType | null;

  @Column({ type: 'text', nullable: true })
  stripeObjectId: string | null;

  @Column({ type: 'text', nullable: true })
  stripeEventId: string | null;

  @Column({ type: 'text', nullable: true })
  referenceType: string | null;

  @Column({ type: 'text', nullable: true })
  referenceId: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: any;

  @Column({ type: 'text', nullable: true })
  idempotencyKey: string;

  @CreateDateColumn()
  createdAt: Date;

  @DeleteDateColumn()
  deletedAt: Date | null;
}
