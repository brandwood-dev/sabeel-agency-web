import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Put, UseGuards, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AssignFreelanceGroupMembersDto } from './dto/assign-freelance-group-members.dto';
import { CreateFreelanceGroupDto } from './dto/create-freelance-group.dto';
import { UpdateFreelanceGroupDto } from './dto/update-freelance-group.dto';
import { FreelanceGroupsService } from './freelance-groups.service';
import { MinioService } from '../../minio/minio.service';

@Controller('sabeel-guide/freelance-groups')
@UseGuards(JwtAuthGuard)
export class FreelanceGroupsController {
  constructor(
    private readonly freelanceGroupsService: FreelanceGroupsService,
    private readonly minioService: MinioService,
  ) {}

  @Post('upload-image')
  @UseInterceptors(FileInterceptor('image'))
  async uploadImage(@UploadedFile() file: any) {
    if (!file) {
      throw new BadRequestException('Missing file. Expected multipart/form-data with field "image".');
    }
    const fileName = `freelance-group-${Date.now()}-${file.originalname}`;
    await this.minioService.uploadFile('images', fileName, file.buffer, file.mimetype);
    const presignedUrl = await this.minioService.getFileUrl('images', fileName);
    return { imageUrl: fileName, presignedUrl };
  }

  @Get('me')
  async getMine(@CurrentUser() user: { userId: string; activeRole?: string }) {
    return this.freelanceGroupsService.getMine(user);
  }

  @Get(':id')
  async getById(
    @CurrentUser() user: { userId: string; activeRole?: string },
    @Param('id') id: string,
  ) {
    return this.freelanceGroupsService.getById(user, id);
  }

  @Get(':id/pilgrims')
  async getMembers(
    @CurrentUser() user: { userId: string; activeRole?: string },
    @Param('id') id: string,
  ) {
    return this.freelanceGroupsService.getMembers(user, id);
  }

  @Get(':id/available-pilgrims')
  async getAvailableAcceptedPilgrims(
    @CurrentUser() user: { userId: string; activeRole?: string },
    @Param('id') id: string,
  ) {
    return this.freelanceGroupsService.getAvailableAcceptedPilgrims(user, id);
  }

  @Post(':id/assign-pilgrims')
  async assignPilgrims(
    @CurrentUser() user: { userId: string; activeRole?: string },
    @Param('id') id: string,
    @Body() dto: AssignFreelanceGroupMembersDto,
  ) {
    return this.freelanceGroupsService.assignPilgrims(user, id, dto?.pilgrimIds || []);
  }

  @Delete(':id/pilgrims/:pilgrimId')
  async removePilgrim(
    @CurrentUser() user: { userId: string; activeRole?: string },
    @Param('id') id: string,
    @Param('pilgrimId') pilgrimId: string,
  ) {
    return this.freelanceGroupsService.removePilgrim(user, id, pilgrimId);
  }

  @Post()
  async create(
    @CurrentUser() user: { userId: string; activeRole?: string },
    @Body() dto: CreateFreelanceGroupDto,
  ) {
    return this.freelanceGroupsService.create(user, dto);
  }

  @Put(':id')
  async update(
    @CurrentUser() user: { userId: string; activeRole?: string },
    @Param('id') id: string,
    @Body() dto: UpdateFreelanceGroupDto,
  ) {
    return this.freelanceGroupsService.update(user, id, dto);
  }

  @Delete(':id')
  async delete(
    @CurrentUser() user: { userId: string; activeRole?: string },
    @Param('id') id: string,
  ) {
    return this.freelanceGroupsService.delete(user, id);
  }
}
