import { Controller, Get, UseGuards } from '@nestjs/common';
import { BookingService } from './booking.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('admin-agence/bookings')
export class BookingController {
  constructor(private readonly bookingService: BookingService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  async findAll(@CurrentUser() user: { userId: string }) {
    return this.bookingService.findAllByAgency(user.userId);
  }

  @Get('confirmed')
  @UseGuards(JwtAuthGuard)
  async findConfirmed(@CurrentUser() user: { userId: string }) {
    return this.bookingService.findConfirmedByAgency(user.userId);
  }
}
