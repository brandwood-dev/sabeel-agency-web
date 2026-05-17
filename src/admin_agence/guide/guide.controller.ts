import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SaveAgencyGuideDto } from './dto/save-guide.dto';
import { AgencyGuideService } from './guide.service';

@Controller('admin-agence/guides')
export class AgencyGuideController {
  constructor(private readonly guideService: AgencyGuideService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  async listAllGuides(
    @CurrentUser() user: { userId: string; activeRole: string },
    @Query('type') type?: 'all' | 'agency' | 'freelance',
  ) {
    return this.guideService.listAllGuides(user, type || 'all');
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getMyGuides(@CurrentUser() user: { userId: string; activeRole: string }) {
    return this.guideService.getMyGuides(user);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  async createGuide(
    @CurrentUser() user: { userId: string; activeRole: string },
    @Body() dto: SaveAgencyGuideDto,
  ) {
    return this.guideService.create(user, dto);
  }

  @Patch(':guideId')
  @UseGuards(JwtAuthGuard)
  async updateGuide(
    @CurrentUser() user: { userId: string; activeRole: string },
    @Param('guideId') guideId: string,
    @Body() dto: SaveAgencyGuideDto,
  ) {
    return this.guideService.update(user, guideId, dto);
  }

  @Delete(':guideId')
  @UseGuards(JwtAuthGuard)
  async deleteGuide(
    @CurrentUser() user: { userId: string; activeRole: string },
    @Param('guideId') guideId: string,
  ) {
    return this.guideService.remove(user, guideId);
  }

  @Post(':guideId/verify-documents')
  @UseGuards(JwtAuthGuard)
  async verifyDocuments(
    @CurrentUser() user: { userId: string; activeRole: string },
    @Param('guideId') guideId: string,
  ) {
    return this.guideService.approveFreelanceDocuments(user, guideId);
  }

  @Post(':guideId/reject-documents')
  @UseGuards(JwtAuthGuard)
  async rejectDocuments(
    @CurrentUser() user: { userId: string; activeRole: string },
    @Param('guideId') guideId: string,
    @Body('reason') reason: string,
  ) {
    return this.guideService.rejectFreelanceDocuments(user, guideId, reason);
  }
}
