import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum ConversationParticipantRole {
  PILGRIM = 'pelerin',
  ACCOMPAGNANT = 'accompagnant',
  AGENCY = 'agence',
  GUIDE = 'guide',
  SYSTEM = 'system',
}

@Entity('messaging_conversations')
export class Conversation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', nullable: true })
  reservationId: string | null;

  @Column({ type: 'uuid', nullable: true })
  groupId: string | null;

  @Column({ type: 'uuid', nullable: true })
  freelanceGroupId: string | null;

  @Column({ type: 'uuid', nullable: true })
  pilgrimUserId: string | null;

  @Column({ type: 'uuid', nullable: true })
  targetPilgrimUserId: string | null;

  @Column({ type: 'uuid', nullable: true })
  agencyId: string | null;

  @Column({ type: 'uuid', nullable: true })
  guideId: string | null;

  @Column({ type: 'uuid', nullable: true })
  supportAdminId: string | null;

  @Column({ nullable: true })
  agencyDisplayName: string;

  @Column({ nullable: true })
  agencyImageUrl: string;

  @Column({ nullable: true })
  guideDisplayName: string;

  @Column({ nullable: true })
  guideImageUrl: string;

  @Column({ nullable: true })
  pilgrimDisplayName: string;

  @Column({ nullable: true })
  pilgrimImageUrl: string;

  @Column({ nullable: true })
  supportDisplayName: string;

  @Column({ nullable: true })
  supportImageUrl: string;

  @Column({ type: 'uuid', nullable: true })
  packId: string | null;

  @Column({ nullable: true })
  groupName: string;

  @Column({ nullable: true })
  groupImageUrl: string;

  @Column({ nullable: true })
  packTitle: string;

  @Column({ nullable: true })
  packImageUrl: string;

  @Column({ default: true })
  isLocked: boolean;

  @Column({ type: 'text', nullable: true })
  lockedReason: string | null;

  @Column({ default: false })
  isArchived: boolean;

  @Column({ type: 'text', nullable: true })
  lastMessageText: string | null;

  @Column({ type: 'timestamp', nullable: true })
  lastMessageAt: Date | null;

  @Column({
    type: 'enum',
    enum: ConversationParticipantRole,
    default: ConversationParticipantRole.PILGRIM,
  })
  createdByRole: ConversationParticipantRole;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
