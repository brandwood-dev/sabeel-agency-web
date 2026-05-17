import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { GroupService } from './group.service';
import { MinioService } from '../../minio/minio.service';

@Controller('admin-agence/groups')
export class GroupController {
  constructor(
    private readonly groupService: GroupService,
    private readonly minioService: MinioService,
  ) {}

  @Post('upload-image')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('image'))
  async uploadImage(@UploadedFile() file: any) {
    const fileName = `group-${Date.now()}-${file.originalname}`;
    await this.minioService.uploadFile('images', fileName, file.buffer, file.mimetype);
    const presignedUrl = await this.minioService.getFileUrl('images', fileName);
    return { imageUrl: fileName, presignedUrl };
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  async create(
    @CurrentUser() user: { userId: string },
    @Body() data: any,
  ) {
    return this.groupService.create(user.userId, data);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  async findAll(@CurrentUser() user: { userId: string }) {
    return this.groupService.findAll(user.userId);
  }

  @Get('available-pilgrims')
  @UseGuards(JwtAuthGuard)
  async getAvailablePilgrims(@CurrentUser() user: { userId: string }) {
    return this.groupService.getAvailablePilgrims(user.userId);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async findOne(
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
  ) {
    return this.groupService.findOne(id, user.userId);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  async update(
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
    @Body() data: any,
  ) {
    return this.groupService.update(id, user.userId, data);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  async remove(
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
  ) {
    return this.groupService.delete(id, user.userId);
  }

  @Post(':id/archive')
  @UseGuards(JwtAuthGuard)
  async archive(
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
  ) {
    return this.groupService.archive(id, user.userId);
  }
  
  @Post(':id/unarchive')
  @UseGuards(JwtAuthGuard)
  async unarchive(
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
  ) {
    return this.groupService.unarchive(id, user.userId);
  }

  @Post(':id/assign-pilgrims')
  @UseGuards(JwtAuthGuard)
  async assignPilgrims(
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
    @Body('pilgrimIds') pilgrimIds: string[],
  ) {
    return this.groupService.assignPilgrims(id, user.userId, pilgrimIds);
  }

  @Delete(':id/pilgrims/:pilgrimId')
  @UseGuards(JwtAuthGuard)
  async removePilgrim(
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
    @Param('pilgrimId') pilgrimId: string,
  ) {
    return this.groupService.removePilgrim(id, user.userId, pilgrimId);
  }
}
