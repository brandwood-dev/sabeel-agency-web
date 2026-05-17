import { CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('freelance_group_members')
@Index(['groupId', 'pilgrimUserId'], { unique: true })
export class FreelanceGroupMember {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  groupId: string;

  @Column({ type: 'uuid' })
  pilgrimUserId: string;

  @CreateDateColumn()
  createdAt: Date;
}
