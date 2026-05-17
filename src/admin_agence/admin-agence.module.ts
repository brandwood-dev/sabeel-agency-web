import { Module } from '@nestjs/common';
import { AdminAgenceAuthModule } from './auth/auth.module';
import { PackUmrahModule } from './pack_umrah/pack-umrah.module';
import { AgencyGuideModule } from './guide/guide.module';
import { ComplaintModule } from './complaint/complaint.module';
import { GroupModule } from './group/group.module';
import { BookingModule } from './booking/booking.module';

@Module({
  imports: [
    AdminAgenceAuthModule,
    PackUmrahModule,
    AgencyGuideModule,
    ComplaintModule,
    GroupModule,
    BookingModule,
  ],
  exports: [
    AdminAgenceAuthModule,
    PackUmrahModule,
    AgencyGuideModule,
    ComplaintModule,
    GroupModule,
    BookingModule,
  ],
})
export class AdminAgenceModule {}
