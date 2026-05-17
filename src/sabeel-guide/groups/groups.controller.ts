import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { GroupsService } from './groups.service';

@Controller('sabeel-guide/groups')
@UseGuards(JwtAuthGuard)
export class GroupsController {
  constructor(private readonly groupsService: GroupsService) {}

  @Get('me')
  async getMyGroups(@CurrentUser() user: { userId: string; activeRole?: string }) {
    return this.groupsService.getMyGroups(user);
  }

  @Get(':id')
  async getGroupById(
    @CurrentUser() user: { userId: string; activeRole?: string },
    @Param('id') id: string,
  ) {
    return this.groupsService.getGroupById(user, id);
  }

  @Get(':id/available-pilgrims')
  async getAvailablePilgrims(
    @CurrentUser() user: { userId: string; activeRole?: string },
    @Param('id') id: string,
  ) {
    return this.groupsService.getAvailablePilgrimsForGroup(user, id);
  }

  @Post(':id/assign-pilgrims')
  async assignPilgrims(
    @CurrentUser() user: { userId: string; activeRole?: string },
    @Param('id') id: string,
    @Body('pilgrimIds') pilgrimIds: string[],
  ) {
    return this.groupsService.assignPilgrims(user, id, pilgrimIds);
  }

  @Delete(':id/pilgrims/:pilgrimId')
  async removePilgrim(
    @CurrentUser() user: { userId: string; activeRole?: string },
    @Param('id') id: string,
    @Param('pilgrimId') pilgrimId: string,
  ) {
    return this.groupsService.removePilgrim(user, id, pilgrimId);
  }
}
