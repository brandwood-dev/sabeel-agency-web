import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum WalletOwnerType {
  PILGRIM = 'PILGRIM',
  GUIDE = 'GUIDE',
  AGENCY = 'AGENCY',
  PLATFORM = 'PLATFORM',
}

@Entity('wallets')
@Index(['ownerType', 'ownerId'], { unique: true })
export class Wallet {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'enum',
    enum: WalletOwnerType,
  })
  ownerType: WalletOwnerType;

  @Column({ type: 'uuid' })
  ownerId: string;

  @Column({ default: 'MAD' })
  currency: string;

  @Column({ type: 'int', default: 0 })
  availableBalance: number;

  @Column({ type: 'int', default: 0 })
  pendingBalance: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date | null;
}
