import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ComplaintService } from './complaint.service';
import { ComplaintController } from './complaint.controller';
import { Complaint } from './entities/complaint.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Complaint])],
  controllers: [ComplaintController],
  providers: [ComplaintService],
  exports: [ComplaintService],
})
export class ComplaintModule {}
