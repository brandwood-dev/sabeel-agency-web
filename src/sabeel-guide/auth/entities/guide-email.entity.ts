import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { Guide } from './guide.entity';

@Entity('guide_emails')
export class GuideEmail {
  @ApiProperty({ description: 'Unique identifier' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'Email address' })
  @Column()
  email: string;

  @ApiProperty({ description: 'Verification status' })
  @Column({ default: false })
  verified: boolean;

  @ApiProperty({ description: 'Creation date' })
  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => Guide, (guide) => guide.emails, { onDelete: 'CASCADE' })
  guide: Guide;
}
