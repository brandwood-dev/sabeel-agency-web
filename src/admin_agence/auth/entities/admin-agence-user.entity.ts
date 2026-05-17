import { BeforeInsert, Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import * as bcrypt from 'bcryptjs';

export enum AdminAgenceRole {
  ADMIN = 'admin',
  SUB_ADMIN = 'sub_admin',
  AGENCE = 'agence',
}

export enum AdminAgenceStatus {
  ACTIVE = 'active',
  PENDING = 'pending',
  REFUSED = 'refused',
  SUSPENDED = 'suspended',
}

@Entity('admin_agence_users')
export class AdminAgenceUser {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column()
  password: string;

  @Column()
  fullName: string;

  @Column({ nullable: true })
  phoneNumber: string;

  @Column({ nullable: true })
  agencyName: string;

  @Column({ unique: true, nullable: true })
  agencyCode: string;

  @Column({ nullable: true })
  agencyLicense: string;

  @Column({ nullable: true })
  agencyType: string;

  @Column({ nullable: true })
  responsibleName: string;

  @Column({ nullable: true })
  responsibleTitle: string;

  @Column({ nullable: true })
  contractDuration: number;

  @Column({ nullable: true, type: 'timestamp' })
  contractStartDate: Date;

  @Column({ nullable: true, type: 'timestamp' })
  contractEndDate: Date;

  @Column({ default: false })
  profileCompletionSubmitted: boolean;

  @Column({ type: 'simple-json', nullable: true })
  agencyDocuments: { label: string; path: string; fileName: string }[];

  @Column({ nullable: true })
  contractFilePath: string;

  @Column({ nullable: true })
  contractFileName: string;

  @Column({ nullable: true })
  profileImagePath: string;

  @Column({ nullable: true })
  coverImagePath: string;

  @Column({ nullable: true })
  createdById: string;

  @Column({ default: false })
  isPrimaryAdmin: boolean;

  @Column({ type: 'simple-array', nullable: true })
  permissions: string[];

  @Column({
    type: 'enum',
    enum: AdminAgenceRole,
  })
  activeRole: AdminAgenceRole;

  @Column({
    type: 'enum',
    enum: AdminAgenceStatus,
    default: AdminAgenceStatus.PENDING,
  })
  status: AdminAgenceStatus;

  @Column({ nullable: true })
  lastLoginAt: Date;
  
  @Column({ type: 'varchar', nullable: true })
  resetPasswordOtp: string | null;

  @Column({ type: 'timestamp', nullable: true })
  resetPasswordExpires: Date | null;

  @Column({ type: 'varchar', nullable: true })
  twoFactorSecret: string | null;

  @Column({ default: false })
  isTwoFactorEnabled: boolean;

  @Column({ type: 'text', nullable: true })
  fcmToken: string;

  @Column({ type: 'varchar', nullable: true })
  stripeConnectedAccountId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

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
