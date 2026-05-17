import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum WalletAuditAction {
  WALLET_CREATED = 'WALLET_CREATED',
  BALANCE_UPDATED = 'BALANCE_UPDATED',
  TRANSACTION_CREATED = 'TRANSACTION_CREATED',
  WITHDRAWAL_REQUESTED = 'WITHDRAWAL_REQUESTED',
  WITHDRAWAL_PROCESSED = 'WITHDRAWAL_PROCESSED',
  WEBHOOK_PROCESSED = 'WEBHOOK_PROCESSED',
}

@Entity('wallet_audit_logs')
@Index(['actorUserId', 'createdAt'])
@Index(['walletId', 'createdAt'])
export class WalletAuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', nullable: true })
  actorUserId: string | null;

  @Column({ type: 'text', nullable: true })
  actorRole: string | null;

  @Column({ type: 'uuid', nullable: true })
  walletId: string | null;

  @Column({
    type: 'enum',
    enum: WalletAuditAction,
  })
  action: WalletAuditAction;

  @Column({ type: 'text', nullable: true })
  message: string | null;

  @Column({ type: 'jsonb', nullable: true })
  data: any;

  @CreateDateColumn()
  createdAt: Date;
}
