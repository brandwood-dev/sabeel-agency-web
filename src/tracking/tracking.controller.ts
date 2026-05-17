import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { UpsertPositionDto } from './dto/upsert-position.dto';
import { TrackingService } from './tracking.service';

@Controller('tracking')
@UseGuards(JwtAuthGuard)
export class TrackingController {
  constructor(private readonly trackingService: TrackingService) {}

  @Post('positions')
  async upsertMyPosition(
    @CurrentUser() user: { userId: string; activeRole?: string },
    @Body() dto: UpsertPositionDto,
  ) {
    return this.trackingService.upsertMyPosition(user, dto);
  }

  @Post('positions/stop')
  async stopSharingMyPosition(@CurrentUser() user: { userId: string; activeRole?: string }) {
    return this.trackingService.stopSharingMyPosition(user);
  }

  @Get('guide/pilgrims-positions')
  async getMyPilgrimsLastPositions(@CurrentUser() user: { userId: string; activeRole?: string }) {
    return this.trackingService.getMyPilgrimsLastPositions(user);
  }

  @Get('pilgrim/:pilgrimUserId/last-position')
  async getPilgrimLastPosition(
    @CurrentUser() user: { userId: string; activeRole?: string },
    @Param('pilgrimUserId') pilgrimUserId: string,
  ) {
    return this.trackingService.getPilgrimLastPositionForAccompagnant(user, pilgrimUserId);
  }
}
