import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { AdminAgenceUser } from '../../../admin_agence/auth/entities/admin-agence-user.entity';
import { PackUmrah } from '../../../admin_agence/pack_umrah/entities/pack-umrah.entity';

export enum ReservationKind {
  PACK = 'pack',
  GUIDE = 'guide',
}

export enum ReservationStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  REJECTED = 'rejected',
  CANCELLED = 'cancelled',
}

@Entity('sabeel_reservations')
export class Reservation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  pilgrimUserId: string;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'pilgrimUserId' })
  pilgrimUser: User;

  @Column({ type: 'uuid', nullable: true })
  agencyId: string | null;

  @ManyToOne(() => AdminAgenceUser, { nullable: true })
  @JoinColumn({ name: 'agencyId' })
  agency: AdminAgenceUser;

  @Column({ type: 'uuid', nullable: true })
  packId: string | null;

  @ManyToOne(() => PackUmrah, { nullable: true })
  @JoinColumn({ name: 'packId' })
  pack: PackUmrah;

  @Column({ type: 'uuid', nullable: true })
  guideId: string | null;

  @Column({ nullable: true })
  guideName: string;

  @Column({ nullable: true })
  guideImageUrl: string;

  @Column({
    type: 'enum',
    enum: ReservationKind,
    default: ReservationKind.PACK,
  })
  kind: ReservationKind;

  @Column({ type: 'uuid', nullable: true })
  conversationId: string | null;

  @Column()
  pilgrimName: string;

  @Column({ nullable: true })
  pilgrimEmail: string;

  @Column({ nullable: true })
  pilgrimPhone: string;

  @Column({ type: 'int', nullable: true })
  age: number | null;

  @Column({ type: 'int', default: 1 })
  pilgrimCount: number;

  @Column({ default: false })
  hasDisease: boolean;

  @Column({ type: 'text', nullable: true })
  medications: string;

  @Column({ type: 'text', nullable: true })
  notes: string;

  @Column({ nullable: true })
  paymentType: string;

  @Column({ nullable: true })
  paymentMode: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  unitPrice: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  totalPrice: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  advanceAmount: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  remainingAmount: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 5 })
  appCommissionRate: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  appCommissionAmount: number;

  @Column({ nullable: true })
  reservationDate: string;

  @Column({ nullable: true })
  packageName: string;

  @Column({ nullable: true })
  agencyName: string;

  @Column({ nullable: true })
  packImageUrl: string;

  @Column({ nullable: true })
  agencyImageUrl: string;

  @Column({
    type: 'enum',
    enum: ReservationStatus,
    default: ReservationStatus.PENDING,
  })
  status: ReservationStatus;

  @Column({ type: 'timestamp', nullable: true })
  respondedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
