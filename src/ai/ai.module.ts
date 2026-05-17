import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { AdminAgenceUser } from '../admin_agence/auth/entities/admin-agence-user.entity';
import { PackUmrah } from '../admin_agence/pack_umrah/entities/pack-umrah.entity';
import { AgencyGuide } from '../admin_agence/guide/entities/guide.entity';
import { Booking } from '../admin_agence/booking/entities/booking.entity';
import { AgencyGroup } from '../admin_agence/group/entities/group.entity';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AdminAgenceUser, PackUmrah, AgencyGuide, Booking, AgencyGroup]),
    CommonModule,
  ],
  providers: [AiService],
  controllers: [AiController],
  exports: [AiService],
})
export class AiModule {}
