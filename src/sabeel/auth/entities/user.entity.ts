import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, BeforeInsert, ManyToOne, JoinColumn } from 'typeorm';
import { AgencyGroup } from '../../../admin_agence/group/entities/group.entity';
import * as bcrypt from 'bcryptjs';

export enum UserRole {
  PELEGRIN = 'pelerin',
  ACCOMPAGNANT = 'accompagnant',
}

export enum UserStatus {
  PENDING = 'pending',
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column()
  password: string;

  @Column()
  firstName: string;

  @Column()
  lastName: string;

  @Column({ unique: true })
  phoneNumber: string;

  @Column({ nullable: true })
  dateOfBirth: Date;

  @Column({ nullable: true })
  gender: string;

  @Column({ nullable: true })
  nationality: string;

  @Column({ nullable: true })
  country: string;

  @Column({ nullable: true })
  city: string;

  @Column({ nullable: true })
  address: string;

  @Column({ nullable: true })
  cinOrPassport: string;

  @Column({ nullable: true })
  photo: string;

  @Column({ nullable: true })
  qrId: string;

  @Column({ type: 'text', nullable: true })
  fcmToken: string;

  @Column({ unique: true })
  uniqueIdentifier: string;

  @Column({
    type: 'enum',
    enum: UserRole,
    default: UserRole.PELEGRIN,
  })
  primaryRole: UserRole;

  @Column({
    type: 'enum',
    enum: UserRole,
    default: UserRole.PELEGRIN,
  })
  activeRole: UserRole;

  @Column({
    type: 'enum',
    enum: UserRole,
    nullable: true,
  })
  secondaryRole: UserRole;

  @Column({
    type: 'enum',
    enum: UserStatus,
    default: UserStatus.PENDING,
  })
  status: UserStatus;

  @Column({ default: false })
  hasAcceptedTerms: boolean;

  @Column({ default: false })
  hasAcceptedPrivacyPolicy: boolean;

  @Column({ default: false })
  shareLocation: boolean;

  @Column({ nullable: true })
  lastLoginAt: Date;

  @Column({ type: 'text', nullable: true })
  bio: string;

  @Column({ type: 'simple-array', nullable: true })
  languages: string[];

  @ManyToOne(() => AgencyGroup, (group) => group.pilgrims, { nullable: true })
  @JoinColumn({ name: 'groupId' })
  group: AgencyGroup;

  @Column({ nullable: true })
  groupId: string | null;

  @Column({ type: 'uuid', nullable: true })
  accompaniedPilgrimId: string | null;

  @Column({ type: 'uuid', nullable: true })
  agencyId: string | null;

  @Column({ type: 'uuid', nullable: true })
  guideId: string | null;

  @CreateDateColumn()

  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @BeforeInsert()
  async generateUniqueIdentifier() {
    if (!this.uniqueIdentifier) {
      // Prendre les 2 premières lettres du nom et ajouter 6 chiffres aléatoires
      const namePrefix = this.firstName ? this.firstName.substring(0, 2).toUpperCase() : 'SB';
      const randomNumbers = Math.floor(100000 + Math.random() * 900000).toString();
      this.uniqueIdentifier = `${namePrefix}${randomNumbers}`;
    }
    // Also populate qrId for consistency
    if (!this.qrId) {
      this.qrId = this.uniqueIdentifier;
    }
  }

  @BeforeInsert()
  async hashPassword() {
    if (this.password) {
      this.password = await bcrypt.hash(this.password, 10);
    }
  }

  async validatePassword(password: string): Promise<boolean> {
    return bcrypt.compare(password, this.password);
  }
}
