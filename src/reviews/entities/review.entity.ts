import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../sabeel/auth/entities/user.entity';

export enum ReviewTargetType {
  AGENCY = 'AGENCE',
  GUIDE = 'GUIDE',
}

@Entity('reviews')
@Index(['authorUserId', 'targetType', 'targetId'], { unique: true })
export class Review {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  authorUserId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'authorUserId' })
  author: User;

  @Column({ type: 'enum', enum: ReviewTargetType })
  targetType: ReviewTargetType;

  @Column({ type: 'uuid' })
  targetId: string;

  @Column({ type: 'int' })
  rating: number;

  @Column({ type: 'text' })
  comment: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
