import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAgenceUser } from '../auth/entities/admin-agence-user.entity';
import { AgencyGuideController } from './guide.controller';
import { AgencyGuideService } from './guide.service';
import { AgencyGuide } from './entities/guide.entity';
import { Guide } from '../../sabeel-guide/auth/entities/guide.entity';

@Module({
  imports: [TypeOrmModule.forFeature([AgencyGuide, AdminAgenceUser, Guide])],
  controllers: [AgencyGuideController],
  providers: [AgencyGuideService],
  exports: [AgencyGuideService],
})
export class AgencyGuideModule {}
