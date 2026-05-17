import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgencyGroup } from '../admin_agence/group/entities/group.entity';
import { AgencyGuide } from '../admin_agence/guide/entities/guide.entity';
import { MessagingModule } from '../messaging/messaging.module';
import { User } from '../sabeel/auth/entities/user.entity';
import { PilgrimLastPosition } from './entities/pilgrim-last-position.entity';
import { TrackingController } from './tracking.controller';
import { TrackingService } from './tracking.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([PilgrimLastPosition, User, AgencyGroup, AgencyGuide]),
    MessagingModule,
  ],
  controllers: [TrackingController],
  providers: [TrackingService],
  exports: [TrackingService, TypeOrmModule],
})
export class TrackingModule {}
