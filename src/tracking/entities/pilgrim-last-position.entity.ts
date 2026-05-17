import { Column, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('pilgrim_last_positions')
export class PilgrimLastPosition {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', unique: true })
  pilgrimUserId: string;

  @Column({ type: 'decimal', precision: 10, scale: 7 })
  latitude: number;

  @Column({ type: 'decimal', precision: 10, scale: 7 })
  longitude: number;

  @Column({ type: 'float', nullable: true })
  accuracy: number | null;

  @Column({ type: 'float', nullable: true })
  speed: number | null;

  @Column({ type: 'float', nullable: true })
  heading: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  deviceTimestamp: Date | null;

  @UpdateDateColumn()
  updatedAt: Date;
}
