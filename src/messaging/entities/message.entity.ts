import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Conversation, ConversationParticipantRole } from './conversation.entity';

export enum MessageType {
  TEXT = 'text',
  RESERVATION_REQUEST = 'reservation_request',
  RESERVATION_STATUS = 'reservation_status',
  SYSTEM = 'system',
}

@Entity('messaging_messages')
export class Message {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  conversationId: string;

  @ManyToOne(() => Conversation, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversationId' })
  conversation: Conversation;

  @Column({ type: 'uuid', nullable: true })
  senderUserId: string | null;

  @Column({
    type: 'enum',
    enum: ConversationParticipantRole,
    default: ConversationParticipantRole.SYSTEM,
  })
  senderRole: ConversationParticipantRole;

  @Column({
    type: 'enum',
    enum: MessageType,
    default: MessageType.TEXT,
  })
  messageType: MessageType;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'simple-json', nullable: true })
  metadata: Record<string, any> | null;

  @CreateDateColumn()
  createdAt: Date;
}
