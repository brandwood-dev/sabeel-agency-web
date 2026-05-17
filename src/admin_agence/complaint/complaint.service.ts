import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Complaint, ComplaintStatus } from './entities/complaint.entity';

@Injectable()
export class ComplaintService {
  constructor(
    @InjectRepository(Complaint)
    private complaintRepository: Repository<Complaint>,
  ) {}

  async create(data: Partial<Complaint>) {
    const complaint = this.complaintRepository.create(data);
    return this.complaintRepository.save(complaint);
  }

  async findAll() {
    return this.complaintRepository.find({
      order: { createdAt: 'DESC' },
    });
  }

  async updateStatus(id: string, status: ComplaintStatus) {
    const complaint = await this.complaintRepository.findOne({ where: { id } });
    if (!complaint) throw new NotFoundException('Complaint not found');

    complaint.status = status;
    return this.complaintRepository.save(complaint);
  }
}
