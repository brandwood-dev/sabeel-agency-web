import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, OneToMany } from 'typeorm';
import { AdminAgenceUser } from '../../auth/entities/admin-agence-user.entity';
import { PackUmrah } from '../../pack_umrah/entities/pack-umrah.entity';
import { AgencyGuide } from '../../guide/entities/guide.entity';
import { User } from '../../../sabeel/auth/entities/user.entity';

export enum GroupStatus {
  ACTIVE = 'active',
  ARCHIVED = 'archived',
}

@Entity('agency_groups')
export class AgencyGroup {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  description: string;

  @Column({
    type: 'enum',
    enum: GroupStatus,
    default: GroupStatus.ACTIVE,
  })
  status: GroupStatus;

  @Column({ type: 'date', nullable: true })
  departureDate: Date;

  @Column({ type: 'int', default: 50 })
  capacity: number;

  @ManyToOne(() => AdminAgenceUser)
  @JoinColumn({ name: 'agencyId' })
  agency: AdminAgenceUser;

  @Column()
  agencyId: string;

  @ManyToOne(() => PackUmrah, { nullable: true })
  @JoinColumn({ name: 'packId' })
  pack: PackUmrah;

  @Column({ nullable: true })
  packId: string;

  @ManyToOne(() => AgencyGuide, { nullable: true })
  @JoinColumn({ name: 'guideId' })
  guide: AgencyGuide;

  @Column({ nullable: true })
  guideId: string;

  @CreateDateColumn()
  createdAt: Date;

  @OneToMany(() => User, (user) => (user as any).group)
  pilgrims: User[];

  @Column({ nullable: true })
  imageUrl: string;

  @UpdateDateColumn()
  updatedAt: Date;
}
