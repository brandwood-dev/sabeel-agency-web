import { Controller, Get, Post, Body, Patch, Param, UseGuards } from '@nestjs/common';
import { ComplaintService } from './complaint.service';
import { ComplaintStatus } from './entities/complaint.entity';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller('admin-agence/complaints')
export class ComplaintController {
  constructor(private readonly complaintService: ComplaintService) {}

  @Post()
  async create(@Body() data: any) {
    return this.complaintService.create(data);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  async findAll() {
    return this.complaintService.findAll();
  }

  @Patch(':id/status')
  @UseGuards(JwtAuthGuard)
  async updateStatus(@Param('id') id: string, @Body('status') status: ComplaintStatus) {
    return this.complaintService.updateStatus(id, status);
  }
}
