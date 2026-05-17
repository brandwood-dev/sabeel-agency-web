import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MinioModule } from '../../minio/minio.module';
import { Reservation } from '../../sabeel/reservation/entities/reservation.entity';
import { User } from '../../sabeel/auth/entities/user.entity';
import { FreelanceGroupsController } from './freelance-groups.controller';
import { FreelanceGroupsService } from './freelance-groups.service';
import { FreelanceGroup } from './entities/freelance-group.entity';
import { FreelanceGroupMember } from './entities/freelance-group-member.entity';

@Module({
  imports: [TypeOrmModule.forFeature([FreelanceGroup, FreelanceGroupMember, User, Reservation]), MinioModule],
  controllers: [FreelanceGroupsController],
  providers: [FreelanceGroupsService],
  exports: [FreelanceGroupsService],
})
export class FreelanceGroupsModule {}
