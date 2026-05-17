import { Controller, Post, Body, Get, UseGuards, Request, Param, BadRequestException, Headers, Delete, UseInterceptors, UploadedFile, Patch } from '@nestjs/common';

import { FileInterceptor } from '@nestjs/platform-express';
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
import { UpdateProfileDto } from '../dto/update-profile.dto';
import { DeleteAccountDto } from '../dto/delete-account.dto';
import { GuideRole } from '../entities/guide.entity';


@Controller('sabeel-guide/auth')
export class AuthController {
  constructor(private authService: AuthService) { }

  @Post('join-agency')
  @UseGuards(JwtAuthGuard)
  async joinAgency(@CurrentUser() user: any, @Body() body: { agencyId: string }) {
    if (!body?.agencyId || typeof body.agencyId !== 'string') {
      throw new BadRequestException('agencyId is required');
    }
    return this.authService.joinAgency(user.userId, body.agencyId);
  }

  @Post('signup/step1')
  async signupStep1(@Body() signupStep1Dto: SignupStep1Dto) {
    return this.authService.signupStep1(signupStep1Dto);
  }

  @Post('signup/step2')
  async signupStep2(
    @Headers('authorization') authorization: string,
    @Body() signupStep2Dto: SignupStep2Dto,
  ) {
    if (!authorization) {
      throw new BadRequestException('Authorization header is required');
    }

    const signupToken = authorization.replace('Bearer ', '');
    return this.authService.signupStep2(signupToken, signupStep2Dto);
  }

  @Post('signup/step3')
  async signupStep3(
    @Headers('authorization') authorization: string,
    @Body() signupStep3Dto: SignupStep3Dto,
  ) {
    if (!authorization) {
      throw new BadRequestException('Authorization header is required');
    }

    const signupToken = authorization.replace('Bearer ', '');
    return this.authService.signupStep3(signupToken, signupStep3Dto);
  }

  @Post('login')
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  async logout(@CurrentUser() user: any) {
    return this.authService.logout(user.userId);
  }

  @Post('expo-push-token')
  @UseGuards(JwtAuthGuard)
  async setExpoPushToken(
    @CurrentUser() user: any,
    @Body() body: { expoPushToken: string },
  ) {
    return this.authService.setExpoPushToken(user.userId, body?.expoPushToken);
  }

  @Post('forgot-password')
  async forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto) {
    return this.authService.forgotPassword(forgotPasswordDto);
  }

  @Post('verify-otp')
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

  @Post('switch-role')
  @UseGuards(JwtAuthGuard, RolesGuard)
  async switchRole(@CurrentUser() user: any, @Body() switchRoleDto: SwitchRoleDto) {
    return this.authService.switchRole(user.userId, switchRoleDto);
  }

  @Post('add-secondary-role/:role')
  @UseGuards(JwtAuthGuard, RolesGuard)
  async addSecondaryRole(@CurrentUser() user: any, @Param('role') role: GuideRole) {
    return this.authService.addSecondaryRole(user.userId, role);
  }

  @Get('profile')
  @UseGuards(JwtAuthGuard)
  async getProfile(@CurrentUser() user: any) {
    return this.authService.getProfile(user.userId);
  }

  @Patch('profile')
  @UseGuards(JwtAuthGuard)
  async updateProfile(@CurrentUser() user: any, @Body() updateProfileDto: UpdateProfileDto) {
    return this.authService.updateProfile(user.userId, updateProfileDto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getCurrentUser(@Request() req) {
    return {
      user: req.user,
      message: 'Current user retrieved successfully',
    };
  }

  @Post('delete-account')
  @UseGuards(JwtAuthGuard)
  async deleteAccount(@CurrentUser() user: any, @Body() deleteAccountDto: DeleteAccountDto) {
    return this.authService.deleteAccount(user.userId, deleteAccountDto);
  }

  @Post('upload-avatar')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('photo'))
  async uploadAvatar(@CurrentUser() user: any, @UploadedFile() file: any) {
    return this.authService.uploadAvatar(user.userId, file);
  }
}
