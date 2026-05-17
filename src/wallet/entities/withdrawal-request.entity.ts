import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum WithdrawalRequestStatus {
  REQUESTED = 'REQUESTED',
  SCHEDULED = 'SCHEDULED',
  PROCESSING = 'PROCESSING',
  PAID = 'PAID',
  REJECTED = 'REJECTED',
  FAILED = 'FAILED',
}

@Entity('wallet_withdrawal_requests')
@Index(['walletId', 'status'])
@Index(['status', 'processableAt'])
@Index(['idempotencyKey'], { unique: true })
export class WithdrawalRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  walletId: string;

  @Column({ type: 'int' })
  amount: number;

  @Column({ default: 'MAD' })
  currency: string;

  @Column({
    type: 'enum',
    enum: WithdrawalRequestStatus,
    default: WithdrawalRequestStatus.REQUESTED,
  })
  status: WithdrawalRequestStatus;

  @Column({ type: 'timestamp' })
  processableAt: Date;

  @Column({ type: 'text' })
  idempotencyKey: string;

  @Column({ type: 'text', nullable: true })
  stripePayoutId: string | null;

  @Column({ type: 'text', nullable: true })
  stripeTransferId: string | null;

  @Column({ type: 'text', nullable: true })
  failureReason: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date | null;
}
