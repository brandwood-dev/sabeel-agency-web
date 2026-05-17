import { Body, Controller, Delete, Get, Param, Patch, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../../common/guards/roles.guard';
import { AdminAgenceRole } from '../auth/entities/admin-agence-user.entity';
import { SavePackUmrahDto } from './dto/save-pack-umrah.dto';
import { PackUmrahStatus } from './entities/pack-umrah.entity';
import { PackUmrahService } from './pack-umrah.service';
import { MinioService } from '../../minio/minio.service';

@Controller('admin-agence/pack-umrah')
export class PackUmrahController {
  constructor(
    private readonly packUmrahService: PackUmrahService,
    private readonly minioService: MinioService,
  ) {}

  @Post('upload-image')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('image'))
  async uploadImage(@UploadedFile() file: any) {
    const fileName = `pack-${Date.now()}-${file.originalname}`;
    await this.minioService.uploadFile('images', fileName, file.buffer, file.mimetype);
    const presignedUrl = await this.minioService.getFileUrl('images', fileName);
    return { imageUrl: fileName, presignedUrl };
  }

  @Get('public/list')
  async getPublicPacks() {
    return this.packUmrahService.getPublicPacks();
  }

  @Get('public/:packId')
  async getPublicPackById(@Param('packId') packId: string) {
    return this.packUmrahService.getPublicPackById(packId);
  }

  @Get('agency/:agencyId/count')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(AdminAgenceRole.ADMIN, AdminAgenceRole.SUB_ADMIN)
  async countAgencyPacks(
    @CurrentUser() user: { userId: string; activeRole: string },
    @Param('agencyId') agencyId: string,
  ) {
    return this.packUmrahService.countAgencyPacks(user, agencyId);
  }

  @Get('agency/:agencyId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(AdminAgenceRole.ADMIN, AdminAgenceRole.SUB_ADMIN)
  async getPacksByAgencyId(
    @CurrentUser() user: { userId: string; activeRole: string },
    @Param('agencyId') agencyId: string,
  ) {
    return this.packUmrahService.getPacksByAgencyId(user, agencyId);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getAgencyPacks(@CurrentUser() user: { userId: string; activeRole: string }) {
    return this.packUmrahService.getAgencyPacks(user);
  }

  @Get(':packId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(AdminAgenceRole.ADMIN, AdminAgenceRole.SUB_ADMIN)
  async getPackById(
    @CurrentUser() user: { userId: string; activeRole: string },
    @Param('packId') packId: string,
  ) {
    return this.packUmrahService.getPackById(user, packId);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  async createPack(
    @CurrentUser() user: { userId: string; activeRole: string },
    @Body() savePackUmrahDto: SavePackUmrahDto,
  ) {
    return this.packUmrahService.create(user, savePackUmrahDto);
  }

  @Patch(':packId')
  @UseGuards(JwtAuthGuard)
  async updatePack(
    @CurrentUser() user: { userId: string; activeRole: string },
    @Param('packId') packId: string,
    @Body() savePackUmrahDto: SavePackUmrahDto,
  ) {
    return this.packUmrahService.update(user, packId, savePackUmrahDto);
  }

  @Delete(':packId')
  @UseGuards(JwtAuthGuard)
  async deletePack(
    @CurrentUser() user: { userId: string; activeRole: string },
    @Param('packId') packId: string,
  ) {
    return this.packUmrahService.remove(user, packId);
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(AdminAgenceRole.ADMIN, AdminAgenceRole.SUB_ADMIN)
  async getAllPacks(@CurrentUser() user: { userId: string; activeRole: string }) {
    return this.packUmrahService.getAllPacks(user);
  }

  @Post(':packId/approve')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(AdminAgenceRole.ADMIN, AdminAgenceRole.SUB_ADMIN)
  async approvePack(
    @CurrentUser() user: { userId: string; activeRole: string },
    @Param('packId') packId: string,
  ) {
    return this.packUmrahService.updateStatus(user, packId, PackUmrahStatus.APPROVED);
  }

  @Post(':packId/reject')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(AdminAgenceRole.ADMIN, AdminAgenceRole.SUB_ADMIN)
  async rejectPack(
    @CurrentUser() user: { userId: string; activeRole: string },
    @Param('packId') packId: string,
  ) {
    return this.packUmrahService.updateStatus(user, packId, PackUmrahStatus.REJECTED);
  }
}
