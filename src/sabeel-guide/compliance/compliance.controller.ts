import { Body, Controller, Get, Post, Res, UseGuards, UseInterceptors, UploadedFiles } from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ComplianceService } from './compliance.service';

@Controller('sabeel-guide/freelance/compliance')
@UseGuards(JwtAuthGuard)
export class ComplianceController {
  constructor(private readonly complianceService: ComplianceService) {}

  @Get('me')
  async getMe(@CurrentUser() user: { userId: string; activeRole?: string }) {
    return this.complianceService.getMe(user);
  }

  @Post('email/request-otp')
  async requestEmailOtp(
    @CurrentUser() user: { userId: string; activeRole?: string },
    @Body() body: { email?: string },
  ) {
    return this.complianceService.requestEmailOtp(user, body?.email);
  }

  @Post('email/verify-otp')
  async verifyEmailOtp(
    @CurrentUser() user: { userId: string; activeRole?: string },
    @Body() body: { email: string; otp: string },
  ) {
    return this.complianceService.verifyEmailOtp(user, body);
  }

  @Get('emails')
  async getEmails(@CurrentUser() user: { userId: string; activeRole?: string }) {
    return this.complianceService.listEmails(user);
  }

  @Post('emails')
  async addEmail(
    @CurrentUser() user: { userId: string; activeRole?: string },
    @Body() body: { email: string },
  ) {
    return this.complianceService.addEmail(user, body.email);
  }

  @Post('documents/upload')
  @UseInterceptors(FileFieldsInterceptor([{ name: 'documents', maxCount: 10 }]))
  async uploadDocuments(
    @CurrentUser() user: { userId: string; activeRole?: string },
    @UploadedFiles() files: { documents?: any[] },
  ) {
    return this.complianceService.uploadDocuments(user, files?.documents || []);
  }

  @Post('contract/upload')
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'signature', maxCount: 1 },
    ]),
  )
  async uploadContract(
    @CurrentUser() user: { userId: string; activeRole?: string },
    @Body() body: { durationMonths: number; signatureText?: string; signatureBase64?: string },
    @UploadedFiles() files: { signature?: any[] },
  ) {
    return this.complianceService.uploadContract(user, body, files);
  }

  @Get('contract/download')
  async downloadContract(
    @CurrentUser() user: { userId: string; activeRole?: string },
    @Res() res: Response,
  ) {
    const url = await this.complianceService.getContractDownloadUrl(user);
    return res.redirect(url);
  }
}
