import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SosController } from './sos.controller';
import { SosGateway } from './sos.gateway';
import { SosService } from './sos.service';
import { User } from '../sabeel/auth/entities/user.entity';
import { AgencyGroup } from '../admin_agence/group/entities/group.entity';
import { AgencyGuide } from '../admin_agence/guide/entities/guide.entity';
import { AdminAgenceUser } from '../admin_agence/auth/entities/admin-agence-user.entity';
import { Reservation } from '../sabeel/reservation/entities/reservation.entity';
import { PackUmrah } from '../admin_agence/pack_umrah/entities/pack-umrah.entity';

@Module({
  imports: [TypeOrmModule.forFeature([User, AgencyGroup, AgencyGuide, AdminAgenceUser, Reservation, PackUmrah])],
  controllers: [SosController],
  providers: [SosGateway, SosService],
  exports: [SosService],
})
export class SosModule {}
