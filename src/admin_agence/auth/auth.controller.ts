import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { FileFieldsInterceptor, FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../../common/guards/roles.guard';
import { AdminAgenceAuthService } from './auth.service';
import { SignupAgenceDto } from './dto/signup-agence.dto';
import { LoginAdminAgenceDto } from './dto/login-admin-agence.dto';
import { CreateSubAdminDto } from './dto/create-sub-admin.dto';
import { BootstrapAdminDto } from './dto/bootstrap-admin.dto';
import { CompleteAgencyProfileDto } from './dto/complete-agency-profile.dto';
import { AdminAgenceRole } from './entities/admin-agence-user.entity';

@Controller('admin-agence/auth')
export class AdminAgenceAuthController {
  constructor(private readonly adminAgenceAuthService: AdminAgenceAuthService) { }

  @Get('public/agencies')
  async listPublicAgencies() {
    return this.adminAgenceAuthService.listPublicAgencies();
  }

  @Get('public/agencies/:agencyId')
  async getPublicAgencyById(@Param('agencyId') agencyId: string) {
    return this.adminAgenceAuthService.getPublicAgencyById(agencyId);
  }

  @Post('signup/agence')
  @UseGuards(ThrottlerGuard)
  async signupAgence(@Body() signupAgenceDto: SignupAgenceDto) {
    return this.adminAgenceAuthService.signupAgence(signupAgenceDto);
  }

  @Post('login')
  @UseGuards(ThrottlerGuard)
  async login(@Body() loginDto: LoginAdminAgenceDto) {
    return this.adminAgenceAuthService.login(loginDto);
  }

  @Post('bootstrap-admin')
  @UseGuards(ThrottlerGuard)
  async bootstrapAdmin(@Body() bootstrapAdminDto: BootstrapAdminDto) {
    return this.adminAgenceAuthService.bootstrapAdmin(bootstrapAdminDto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() user: { userId: string }) {
    return this.adminAgenceAuthService.getProfile(user.userId);
  }

  @Post('me/profile-image')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  async uploadProfileImage(@CurrentUser() user: { userId: string }, @UploadedFile() file: any) {
    return this.adminAgenceAuthService.uploadProfileImage(user.userId, file);
  }

  @Post('me/cover-image')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  async uploadCoverImage(@CurrentUser() user: { userId: string }, @UploadedFile() file: any) {
    return this.adminAgenceAuthService.uploadCoverImage(user.userId, file);
  }

  @Post('agency-profile-completion')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'documents', maxCount: 10 },
      { name: 'contract', maxCount: 1 },
    ]),
  )
  async completeAgencyProfile(
    @CurrentUser() user: { userId: string; activeRole: string },
    @Body() completeAgencyProfileDto: CompleteAgencyProfileDto,
    @UploadedFiles()
    files: {
      documents?: any[];
      contract?: any[];
    },
  ) {
    return this.adminAgenceAuthService.completeAgencyProfile(user, completeAgencyProfileDto, files);
  }

  @Get('agencies/submissions')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(AdminAgenceRole.ADMIN, AdminAgenceRole.SUB_ADMIN)
  async getAgencySubmissions(@CurrentUser() user: { userId: string; activeRole: string }) {
    return this.adminAgenceAuthService.getAgencySubmissions(user);
  }

  @Get('agencies/:agencyId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(AdminAgenceRole.ADMIN, AdminAgenceRole.SUB_ADMIN)
  async getAgencyById(
    @CurrentUser() user: { userId: string; activeRole: string },
    @Param('agencyId') agencyId: string,
  ) {
    return this.adminAgenceAuthService.getAgencyById(user, agencyId);
  }

  @Post('agencies/:agencyId/verify')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(AdminAgenceRole.ADMIN, AdminAgenceRole.SUB_ADMIN)
  async verifyAgencySubmission(
    @CurrentUser() user: { userId: string; activeRole: string },
    @Param('agencyId') agencyId: string,
  ) {
    return this.adminAgenceAuthService.verifyAgencySubmission(user, agencyId);
  }

  @Post('agencies/:agencyId/reject')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(AdminAgenceRole.ADMIN, AdminAgenceRole.SUB_ADMIN)
  async rejectAgencySubmission(
    @CurrentUser() user: { userId: string; activeRole: string },
    @Param('agencyId') agencyId: string,
  ) {
    return this.adminAgenceAuthService.rejectAgencySubmission(user, agencyId);
  }

  @Post('sub-admin')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(AdminAgenceRole.ADMIN)
  async createSubAdmin(
    @CurrentUser() user: { userId: string; activeRole: string },
    @Body() createSubAdminDto: CreateSubAdminDto,
  ) {
    return this.adminAgenceAuthService.createSubAdmin(user, createSubAdminDto);
  }

  @Post('forgot-password')
  async forgotPassword(@Body('email') email: string) {
    return this.adminAgenceAuthService.forgotPassword(email);
  }

  @Post('verify-otp')
  async verifyOtp(@Body('email') email: string, @Body('otp') otp: string) {
    return this.adminAgenceAuthService.verifyOtp(email, otp);
  }

  @Post('reset-password')
  async resetPassword(
    @Body('email') email: string,
    @Body('otp') otp: string,
    @Body('password') password: string,
  ) {
    return this.adminAgenceAuthService.resetPassword(email, otp, password);
  }

  @Post('2fa/generate')
  @UseGuards(JwtAuthGuard)
  async generate2FA(@CurrentUser() user: { userId: string }) {
    return this.adminAgenceAuthService.generateTwoFactorSecret(user.userId);
  }

  @Post('2fa/enable')
  @UseGuards(JwtAuthGuard)
  async enable2FA(@CurrentUser() user: { userId: string }, @Body('code') code: string) {
    return this.adminAgenceAuthService.enableTwoFactor(user.userId, code);
  }

  @Post('2fa/disable')
  @UseGuards(JwtAuthGuard)
  async disable2FA(@CurrentUser() user: { userId: string }) {
    return this.adminAgenceAuthService.disableTwoFactor(user.userId);
  }

  @Post('2fa/verify-login')
  async verify2FALogin(@Body('userId') userId: string, @Body('code') code: string) {
    return this.adminAgenceAuthService.verifyTwoFactorLogin(userId, code);
  }

  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  async changePassword(
    @CurrentUser() user: { userId: string },
    @Body('oldPassword') oldPass: string,
    @Body('newPassword') newPass: string,
  ) {
    return this.adminAgenceAuthService.changePassword(user.userId, oldPass, newPass);
  }
}
