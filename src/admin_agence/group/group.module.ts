import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GroupService } from './group.service';
import { GroupController } from './group.controller';
import { AgencyGroup } from './entities/group.entity';
import { User } from '../../sabeel/auth/entities/user.entity';

import { MinioModule } from '../../minio/minio.module';

@Module({
  imports: [TypeOrmModule.forFeature([AgencyGroup, User]), MinioModule],
  controllers: [GroupController],
  providers: [GroupService],
  exports: [GroupService],
})
export class GroupModule { }
