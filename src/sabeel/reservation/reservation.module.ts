import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAgenceUser } from '../../admin_agence/auth/entities/admin-agence-user.entity';
import { PackUmrah } from '../../admin_agence/pack_umrah/entities/pack-umrah.entity';
import { CommonModule } from '../../common/common.module';
import { MessagingModule } from '../../messaging/messaging.module';
import { MinioModule } from '../../minio/minio.module';
import { Guide } from '../../sabeel-guide/auth/entities/guide.entity';
import { User } from '../auth/entities/user.entity';
import { ReservationController } from './reservation.controller';
import { ReservationService } from './reservation.service';
import { Reservation } from './entities/reservation.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Reservation, User, AdminAgenceUser, PackUmrah, Guide]),
    CommonModule,
    MinioModule,
    MessagingModule,
  ],
  controllers: [ReservationController],
  providers: [ReservationService],
  exports: [ReservationService],
})
export class ReservationModule {}
