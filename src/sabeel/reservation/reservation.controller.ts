import { Controller, Get, Param, Post, Body, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CreateGuideReservationDto, CreateReservationDto } from './dto/create-reservation.dto';
import { ReservationStatus } from './entities/reservation.entity';
import { ReservationService } from './reservation.service';

@Controller('sabeel/reservations')
@UseGuards(JwtAuthGuard)
export class ReservationController {
  constructor(private readonly reservationService: ReservationService) {}

  @Post()
  async createReservation(
    @CurrentUser() user: { userId: string; activeRole?: string },
    @Body() dto: CreateReservationDto,
  ) {
    return this.reservationService.createReservation(user, dto);
  }

  @Post('guide')
  async createGuideReservation(
    @CurrentUser() user: { userId: string; activeRole?: string },
    @Body() dto: CreateGuideReservationDto,
  ) {
    return this.reservationService.createGuideReservation(user, dto);
  }

  @Get('mine')
  async getMyReservations(@CurrentUser() user: { userId: string; activeRole?: string }) {
    return this.reservationService.getMyReservations(user);
  }

  @Get('agency')
  async getAgencyReservations(@CurrentUser() user: { userId: string; activeRole?: string }) {
    return this.reservationService.getAgencyReservations(user);
  }

  @Get('guide')
  async getGuideReservations(@CurrentUser() user: { userId: string; activeRole?: string }) {
    return this.reservationService.getGuideReservations(user);
  }

  @Post(':reservationId/accept')
  async acceptReservation(
    @CurrentUser() user: { userId: string; activeRole?: string },
    @Param('reservationId') reservationId: string,
  ) {
    return this.reservationService.updateReservationStatus(user, reservationId, ReservationStatus.ACCEPTED);
  }

  @Post(':reservationId/reject')
  async rejectReservation(
    @CurrentUser() user: { userId: string; activeRole?: string },
    @Param('reservationId') reservationId: string,
  ) {
    return this.reservationService.updateReservationStatus(user, reservationId, ReservationStatus.REJECTED);
  }

  @Post(':reservationId/accept-guide')
  async acceptGuideReservation(
    @CurrentUser() user: { userId: string; activeRole?: string },
    @Param('reservationId') reservationId: string,
  ) {
    return this.reservationService.updateGuideReservationStatus(user, reservationId, ReservationStatus.ACCEPTED);
  }

  @Post(':reservationId/reject-guide')
  async rejectGuideReservation(
    @CurrentUser() user: { userId: string; activeRole?: string },
    @Param('reservationId') reservationId: string,
  ) {
    return this.reservationService.updateGuideReservationStatus(user, reservationId, ReservationStatus.REJECTED);
  }
}
