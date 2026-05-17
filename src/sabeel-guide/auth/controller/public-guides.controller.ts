import { Controller, Get, Param, Query, NotFoundException } from '@nestjs/common';
import { AuthService } from '../services/auth.service';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { GuideRole } from '../entities/guide.entity';

@ApiTags('Public Guides')
@Controller('sabeel-guide/auth/public/guides')
export class PublicGuidesController {
  constructor(private readonly authService: AuthService) {}

  @Get()
  @ApiOperation({ summary: 'List all active guides' })
  async findAll(
    @Query('search') search?: string,
    @Query('role') role?: GuideRole,
  ) {
    return this.authService.findAllActiveGuides(search, role);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get guide profile by ID' })
  async findOne(@Param('id') id: string) {
    const profile = await this.authService.getProfile(id);
    if (!profile) {
      throw new NotFoundException('Guide not found');
    }
    return profile;
  }
}
