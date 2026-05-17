import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { GuideEmail } from './guide-email.entity';

export enum GuideRole {
  FREELANCE = 'freelance',
  AGENCY = 'agency',
}

export enum GuideStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  PENDING = 'pending',
}

export enum Gender {
  MALE = 'male',
  FEMALE = 'female',
  OTHER = 'other',
}

 export enum FreelanceDocumentsVerificationStatus {
   PENDING = 'pending',
   APPROVED = 'approved',
   REJECTED = 'rejected',
 }

@Entity('guides')
export class Guide {
  @ApiProperty({ description: 'Unique identifier of the guide' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'Email address' })
  @Column({ unique: true })
  email: string;

  @ApiProperty({ description: 'Phone number' })
  @Column({ nullable: true })
  phoneNumber: string;

  @ApiProperty({ description: 'Hashed password' })
  @Column({ select: false })
  password: string;

  @ApiProperty({ description: 'First name' })
  @Column({ nullable: true })
  firstName: string;

  @ApiProperty({ description: 'Last name' })
  @Column({ nullable: true })
  lastName: string;

  @ApiProperty({ description: 'Date of birth' })
  @Column({ type: 'date', nullable: true })
  dateOfBirth: Date;

  @ApiProperty({ enum: Gender, description: 'Gender' })
  @Column({ type: 'enum', enum: Gender, nullable: true })
  gender: Gender;

  @ApiProperty({ description: 'Nationality' })
  @Column({ nullable: true })
  nationality: string;

  @ApiProperty({ description: 'Country of residence' })
  @Column({ nullable: true })
  countryOfResidence: string;

  @ApiProperty({ description: 'Full address' })
  @Column({ nullable: true })
  fullAddress: string;

  @ApiProperty({ description: 'Document type (ID card or passport)' })
  @Column({ nullable: true })
  documentType: string;

  @ApiProperty({ description: 'Document number' })
  @Column({ nullable: true })
  documentNumber: string;

  @ApiProperty({ description: 'Issuing country' })
  @Column({ nullable: true })
  issuingCountry: string;

  @ApiProperty({ description: 'Document expiry date' })
  @Column({ type: 'date', nullable: true })
  documentExpiryDate: Date;

  @ApiProperty({ enum: GuideRole, description: 'Primary role' })
  @Column({ type: 'enum', enum: GuideRole, default: GuideRole.FREELANCE })
  primaryRole: GuideRole;

  @ApiProperty({ enum: GuideRole, description: 'Secondary role (if any)' })
  @Column({ type: 'enum', enum: GuideRole, nullable: true })
  secondaryRole: GuideRole | null;

  @ApiProperty({ enum: GuideRole, description: 'Currently active role' })
  @Column({ type: 'enum', enum: GuideRole, default: GuideRole.FREELANCE })
  activeRole: GuideRole;

  @ApiProperty({ enum: GuideStatus, description: 'Account status' })
  @Column({ type: 'enum', enum: GuideStatus, default: GuideStatus.PENDING })
  status: GuideStatus;

  @ApiProperty({ description: 'Email verification status' })
  @Column({ default: false })
  isEmailVerified: boolean;

  @ApiProperty({ description: 'Freelance documents keys (MinIO) required for profile visibility' })
  @Column({ type: 'simple-array', nullable: true })
  freelanceDocuments: string[];

  @ApiProperty({ description: 'Freelance documents upload timestamp' })
  @Column({ type: 'timestamp', nullable: true })
  freelanceDocumentsUploadedAt: Date | null;

   @ApiProperty({
     enum: FreelanceDocumentsVerificationStatus,
     description: 'Freelance documents verification status',
   })
   @Column({
     type: 'enum',
     enum: FreelanceDocumentsVerificationStatus,
     default: FreelanceDocumentsVerificationStatus.PENDING,
   })
   freelanceDocumentsVerificationStatus: FreelanceDocumentsVerificationStatus;

   @ApiProperty({ description: 'Freelance documents verification response timestamp' })
   @Column({ type: 'timestamp', nullable: true })
   freelanceDocumentsReviewedAt: Date | null;

   @ApiProperty({ description: 'Freelance documents rejection reason (if rejected)' })
   @Column({ type: 'text', nullable: true })
   freelanceDocumentsRejectReason: string | null;

  @ApiProperty({ description: 'Signed contract PDF key (MinIO documents bucket)' })
  @Column({ type: 'text', nullable: true })
  freelanceContractPdfKey: string | null;

  @ApiProperty({ description: 'Contract signature image key (MinIO images bucket)' })
  @Column({ type: 'text', nullable: true })
  freelanceContractSignatureKey: string | null;

  @ApiProperty({ description: 'Freelance contract signature timestamp' })
  @Column({ type: 'timestamp', nullable: true })
  freelanceContractSignedAt: Date | null;

  @ApiProperty({ description: 'Freelance contract duration in months (6, 12, 24)' })
  @Column({ type: 'int', nullable: true })
  freelanceContractDurationMonths: number | null;

  @ApiProperty({ description: 'Freelance contract expiration timestamp' })
  @Column({ type: 'timestamp', nullable: true })
  freelanceContractExpiresAt: Date | null;

  @ApiProperty({ description: 'Timestamp when contract expiration notification was sent (anti-spam)' })
  @Column({ type: 'timestamp', nullable: true })
  freelanceContractExpirationNotifiedAt: Date | null;

  @ApiProperty({ description: 'Expo push token (ExponentPushToken...) for mobile push notifications' })
  @Column({ type: 'text', nullable: true })
  expoPushToken: string | null;

  @ApiProperty({ description: 'Terms acceptance status' })
  @Column({ default: false })
  hasAcceptedTerms: boolean;

  @ApiProperty({ description: 'Profile photo path in MinIO' })
  @Column({ nullable: true })
  photo: string;

  @ApiProperty({ description: 'Short biography' })
  @Column({ type: 'text', nullable: true })
  bio: string;

  @ApiProperty({ description: 'Languages spoken by the guide' })
  @Column({ type: 'simple-array', nullable: true })
  languages: string[];

  @ApiProperty({ description: 'Unique identifier for QR and internal ref' })
  @Column({ unique: true, nullable: true })
  uniqueIdentifier: string;

  @ApiProperty({ description: 'Specialties of the guide' })
  @Column({ type: 'simple-array', nullable: true })
  specialties: string[];

  @ApiProperty({ description: 'Years of experience' })
  @Column({ type: 'int', default: 0 })
  experience: number;

  @ApiProperty({ description: 'Price per day in TND' })
  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  pricePerDay: number;

  @ApiProperty({ description: 'Simplified location (e.g., Tunis, Tunisie)' })
  @Column({ nullable: true })
  location: string;

  @ApiProperty({ description: 'Agency id when guide is attached as agency guide' })
  @Column({ type: 'uuid', nullable: true })
  agencyId: string | null;

  @ApiProperty({ description: 'Stripe Connect account id (Express) for payouts', required: false })
  @Column({ type: 'varchar', nullable: true })
  stripeConnectedAccountId: string | null;


  @ApiProperty({ description: 'Privacy policy acceptance status' })
  @Column({ default: false })
  hasAcceptedPrivacyPolicy: boolean;


  @ApiProperty({ description: 'Last login timestamp' })
  @Column({ type: 'timestamp', nullable: true })
  lastLoginAt: Date | null;

  @ApiProperty({ description: 'Account creation timestamp' })
  @Column({ default: true })
  isVisible: boolean;

  @CreateDateColumn()

  createdAt: Date;

  @ApiProperty({ description: 'List of secondary emails' })
  @OneToMany(() => GuideEmail, (email) => email.guide)
  emails: GuideEmail[];

  @ApiProperty({ description: 'Account update timestamp' })
  @UpdateDateColumn()
  updatedAt: Date;
}
