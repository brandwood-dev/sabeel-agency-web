import { Column, CreateDateColumn, Entity, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { AdminAgenceUser } from '../../auth/entities/admin-agence-user.entity';

export enum AgencyGuideStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  BANNED = 'banned',
}

@Entity('admin_agence_guides')
export class AgencyGuide {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  agencyId: string;

  @ManyToOne(() => AdminAgenceUser, { nullable: false, onDelete: 'CASCADE' })
  agency: AdminAgenceUser;

  @Column({ nullable: true })
  fullName: string;

  @Column({ nullable: true })
  firstName: string;

  @Column({ nullable: true })
  lastName: string;

  @Column({ nullable: true })
  phoneNumber: string;

  @Column({ nullable: true })
  phone: string;

  @Column({ nullable: true })
  cinPassport: string;

  @Column({ nullable: true })
  email: string;

  @Column({ type: 'uuid', nullable: true })
  guideUserId: string | null;

  @Column({ type: 'simple-json', nullable: true })
  languages: string[];

  @Column({ nullable: true })
  profileImageUrl: string;

  @Column({ nullable: true })
  photo: string;

  @Column({ nullable: true })
  bio: string;

  @Column({ nullable: true })
  experience: string;

  @Column({
    type: 'enum',
    enum: AgencyGuideStatus,
    default: AgencyGuideStatus.ACTIVE,
  })
  status: AgencyGuideStatus;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
