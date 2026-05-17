import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAgenceUser } from '../auth/entities/admin-agence-user.entity';
import { PackUmrahController } from './pack-umrah.controller';
import { PackUmrahService } from './pack-umrah.service';
import { PackUmrah } from './entities/pack-umrah.entity';

@Module({
  imports: [TypeOrmModule.forFeature([PackUmrah, AdminAgenceUser])],
  controllers: [PackUmrahController],
  providers: [PackUmrahService],
  exports: [PackUmrahService],
})
export class PackUmrahModule {}
