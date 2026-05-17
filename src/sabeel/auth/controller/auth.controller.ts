import { Controller, Post, Body, Get, UseGuards, Request, Param, BadRequestException, Headers, Delete, Patch, UploadedFile } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { FileInterceptor } from '@nestjs/platform-express';
import { UseInterceptors } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../../common/guards/roles.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { AuthService } from '../services/auth.service';
import { SignupStep1Dto } from '../dto/signup-step1.dto';
import { SignupStep2Dto } from '../dto/signup-step2.dto';
import { SignupStep3Dto } from '../dto/signup-step3.dto';
import { LoginDto } from '../dto/login.dto';
import { SwitchRoleDto } from '../dto/switch-role.dto';
import { ForgotPasswordDto } from '../dto/forgot-password.dto';
import { VerifyOtpDto } from '../dto/verify-otp.dto';
import { ChangePasswordDto } from '../dto/change-password.dto';
import { UserRole } from '../entities/user.entity';

@Controller('sabeel/auth')
export class AuthController {
  constructor(private authService: AuthService) { }

  @Post('signup')
  @UseGuards(ThrottlerGuard)
  async signup(@Body() signupStep1Dto: SignupStep1Dto) {
    return this.authService.signupStep1(signupStep1Dto);
  }

  @Post('complete-profile/step2')
  @UseGuards(JwtAuthGuard)
  async completeProfileStep2(@CurrentUser() user: any, @Body() profileStep2Dto: SignupStep2Dto) {
    return this.authService.completeProfileStep2(user.userId, profileStep2Dto);
  }

  @Post('complete-profile/step3')
  @UseGuards(JwtAuthGuard)
  async completeProfileStep3(@CurrentUser() user: any, @Body() profileStep3Dto: SignupStep3Dto) {
    return this.authService.completeProfileStep3(user.userId, profileStep3Dto);
  }

  @Post('login')
  @UseGuards(ThrottlerGuard)
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  async logout(@CurrentUser() user: any) {
    return this.authService.logout(user.userId);
  }

  @Post('forgot-password')
  @UseGuards(ThrottlerGuard)
  async forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto) {
    return this.authService.forgotPassword(forgotPasswordDto);
  }

  @Post('verify-otp')
  @UseGuards(ThrottlerGuard)
  async verifyOtp(
    @Headers('authorization') authorization: string,
    @Body() verifyOtpDto: VerifyOtpDto,
  ) {
    if (!authorization) {
      throw new BadRequestException('Authorization header is required');
    }

    const resetToken = authorization.replace('Bearer ', '');
    return this.authService.verifyOtp(resetToken, verifyOtpDto);
  }

  @Post('change-password')
  @UseGuards(ThrottlerGuard)
  async changePassword(
    @Headers('authorization') authorization: string,
    @Body() changePasswordDto: ChangePasswordDto,
  ) {
    if (!authorization) {
      throw new BadRequestException('Authorization header is required');
    }

    const resetToken = authorization.replace('Bearer ', '');
    return this.authService.changePassword(resetToken, changePasswordDto);
  }

  @Post('update-password')
  @UseGuards(JwtAuthGuard)
  async updatePassword(@CurrentUser() user: any, @Body() changePasswordDto: ChangePasswordDto) {
    return this.authService.updatePassword(user.userId, changePasswordDto);
  }

  @Post('switch-role')
  @UseGuards(JwtAuthGuard, RolesGuard)
  async switchRole(@CurrentUser() user: any, @Body() switchRoleDto: SwitchRoleDto) {
    return this.authService.switchRole(user.userId, switchRoleDto);
  }

  @Post('add-secondary-role/:role')
  @UseGuards(JwtAuthGuard, RolesGuard)
  async addSecondaryRole(@CurrentUser() user: any, @Param('role') role: UserRole) {
    return this.authService.addSecondaryRole(user.userId, role);
  }

  @Get('profile')
  @UseGuards(JwtAuthGuard)
  async getProfile(@CurrentUser() user: any) {
    return this.authService.getProfile(user.userId);
  }

  @Patch('update-profile')
  @UseGuards(JwtAuthGuard)
  async updateProfile(@CurrentUser() user: any, @Body() updateData: any) {
    return this.authService.updateProfile(user.userId, updateData);
  }

  @Post('upload-photo')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('photo'))
  async uploadPhoto(@CurrentUser() user: any, @UploadedFile() file: any) {
    if (!file) throw new BadRequestException('File is required');
    return this.authService.uploadProfilePhoto(user.userId, file);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getCurrentUser(@CurrentUser() user: any) {
    return {
      user: user,
      message: 'Current user retrieved successfully',
    };
  }

  @Get('pilgrim/:identifier')
  @UseGuards(JwtAuthGuard)
  async findPilgrimByIdentifier(@Param('identifier') identifier: string) {
    return this.authService.findPilgrimByIdentifier(identifier);
  }

  @Post('accompagnant/link-pilgrim')
  @UseGuards(JwtAuthGuard)
  async linkPilgrimToAccompagnant(
    @CurrentUser() user: { userId: string; activeRole?: string },
    @Body() body: { identifier: string },
  ) {
    return this.authService.linkPilgrimToAccompagnant(user, body?.identifier);
  }

  @Get('accompagnant/my-pilgrim')
  @UseGuards(JwtAuthGuard)
  async getMyAccompaniedPilgrim(@CurrentUser() user: { userId: string; activeRole?: string }) {
    return this.authService.getMyAccompaniedPilgrim(user);
  }

  @Get('admin/pilgrims')
  @UseGuards(JwtAuthGuard)
  async listPilgrimsForAdmin(@CurrentUser() user: { userId: string; activeRole?: string }) {
    return this.authService.listPilgrimsForAdmin(user);
  }

  @Post('delete-account')
  @UseGuards(JwtAuthGuard)
  async deleteAccount(@CurrentUser() user: any) {
    return this.authService.deleteAccount(user.userId);
  }

  @Post('support')
  @UseGuards(JwtAuthGuard)
  async sendSupportMessage(@CurrentUser() user: any, @Body() body: { message: string }) {
    return this.authService.sendSupportMessage(user.userId, body);
  }

}


