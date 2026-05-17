import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Booking, BookingStatus } from './entities/booking.entity';

@Injectable()
export class BookingService {
  constructor(
    @InjectRepository(Booking)
    private bookingRepository: Repository<Booking>,
  ) {}

  async findAllByAgency(agencyId: string) {
    return this.bookingRepository.find({
      where: { agencyId },
      relations: ['user', 'pack'],
      order: { createdAt: 'DESC' },
    });
  }

  async findConfirmedByAgency(agencyId: string) {
    return this.bookingRepository.find({
      where: {
        agencyId,
        status: BookingStatus.ACCEPTED,
        firstAdvancePaid: true,
      },
      relations: ['user', 'pack'],
      order: { createdAt: 'DESC' },
    });
  }

  async updateStatus(id: string, agencyId: string, status: BookingStatus) {
    const booking = await this.bookingRepository.findOne({ where: { id, agencyId } });
    if (!booking) throw new NotFoundException('Booking not found');
    booking.status = status;
    return this.bookingRepository.save(booking);
  }

  async updatePayment(id: string, agencyId: string, data: { firstAdvancePaid?: boolean; amountPaid?: number }) {
    const booking = await this.bookingRepository.findOne({ where: { id, agencyId } });
    if (!booking) throw new NotFoundException('Booking not found');
    
    if (data.firstAdvancePaid !== undefined) booking.firstAdvancePaid = data.firstAdvancePaid;
    if (data.amountPaid !== undefined) booking.amountPaid = data.amountPaid;
    
    return this.bookingRepository.save(booking);
  }
}
