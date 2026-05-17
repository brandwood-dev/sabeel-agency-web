import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export enum ComplaintStatus {
  NEW = 'nouvelle',
  IN_PROGRESS = 'en_cours',
  RESOLVED = 'résolue',
  ARCHIVED = 'archivée',
}

export enum ComplaintSource {
  APP = 'App Sabeel',
  AGENCY = 'Sabeel Agence',
  GUIDE = 'Guide',
  AGENCY_PLATFORM = 'Plateforme agence',
}

@Entity('complaints')
export class Complaint {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ default: ComplaintSource.AGENCY_PLATFORM })
  source: string;

  @Column({ default: 'agency_platform' })
  sourceType: string; // app, agency, guide, agency_platform

  @Column()
  target: string; // Application, Agence, Guide, Plateforme agence

  @Column()
  category: string;

  @Column()
  sender: string;

  @Column({ type: 'text' })
  message: string;

  @Column({
    type: 'enum',
    enum: ComplaintStatus,
    default: ComplaintStatus.NEW,
  })
  status: ComplaintStatus;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
