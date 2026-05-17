import { Column, CreateDateColumn, Entity, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { AdminAgenceUser } from '../../auth/entities/admin-agence-user.entity';

export enum PackUmrahStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

@Entity('admin_agence_pack_umrah')
export class PackUmrah {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  agencyId: string;

  @ManyToOne(() => AdminAgenceUser, { nullable: false, onDelete: 'CASCADE' })
  agency: AdminAgenceUser;

  @Column()
  title: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  price: number;

  @Column({ nullable: true })
  departureDate: string;

  @Column({ nullable: true })
  arrivalDate: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ nullable: true })
  hotelMekkah: string;

  @Column({ nullable: true })
  hotelMekkahStars: string;

  @Column({ nullable: true })
  hotelMedina: string;

  @Column({ nullable: true })
  hotelMedinaStars: string;

  @Column({ default: true })
  volDirect: boolean;

  @Column({ default: false })
  hasEscale: boolean;

  @Column({ nullable: true, type: 'text' })
  escaleDetails: string;

  @Column({ default: true })
  visaInclus: boolean;

  @Column({ default: true })
  transfert: boolean;

  @Column({ nullable: true })
  guideName: string;

  @Column({ type: 'uuid', nullable: true })
  guideId: string | null;

  @Column({ type: 'simple-json', nullable: true })
  guideLanguages: string[];

  @Column({ nullable: true })
  agencyAddress: string;

  @Column({ type: 'float', nullable: true })
  lat: number;

  @Column({ type: 'float', nullable: true })
  lng: number;

  @Column({ type: 'text', nullable: true })
  imageUrl: string;

  @Column({ default: true })
  isVisible: boolean;

  @Column({ default: false })
  isArchived: boolean;

  @Column({ nullable: true })
  priceSharedRoom: string;

  @Column({ nullable: true })
  priceIndividualRoom: string;

  @Column({ nullable: true })
  priceAdult: string;

  @Column({ nullable: true })
  priceChild: string;

  @Column({ nullable: true })
  priceSenior: string;

  @Column({ type: 'simple-json', nullable: true })
  hotelMekkahImages: string[];

  @Column({ type: 'simple-json', nullable: true })
  hotelMedinaImages: string[];

  @Column({ type: 'simple-json', nullable: true })
  program: { day: string; title: string; description: string }[];

  @Column({
    type: 'enum',
    enum: PackUmrahStatus,
    default: PackUmrahStatus.PENDING,
  })
  status: PackUmrahStatus;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
