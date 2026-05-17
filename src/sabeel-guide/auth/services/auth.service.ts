import { Injectable, UnauthorizedException, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { Guide, GuideStatus, GuideRole } from '../entities/guide.entity';
import { AdminAgenceStatus, AdminAgenceUser } from '../../../admin_agence/auth/entities/admin-agence-user.entity';
import { SignupStep1Dto } from '../dto/signup-step1.dto';
import { SignupStep2Dto } from '../dto/signup-step2.dto';
import { SignupStep3Dto } from '../dto/signup-step3.dto';
import { LoginDto } from '../dto/login.dto';
import { SwitchRoleDto } from '../dto/switch-role.dto';
import { ForgotPasswordDto } from '../dto/forgot-password.dto';
import { VerifyOtpDto } from '../dto/verify-otp.dto';
import { ChangePasswordDto } from '../dto/change-password.dto';
import { DeleteAccountDto } from '../dto/delete-account.dto';
import { SessionStorageService, SignupSessionData } from './session-storage.service';

import { EmailService } from './email.service';
import { MinioService } from '../../../minio/minio.service';
import { ConfigService } from '@nestjs/config';
import { NotificationsGateway } from '../../../common/gateways/notifications.gateway';
import { AgencyGuide } from '../../../admin_agence/guide/entities/guide.entity';
import { PaymentsService } from '../../../payments/payments.service';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(Guide)
    private guideRepository: Repository<Guide>,
    @InjectRepository(AdminAgenceUser)
    private adminAgenceRepository: Repository<AdminAgenceUser>,
    @InjectRepository(AgencyGuide)
    private agencyGuideRepository: Repository<AgencyGuide>,
    private jwtService: JwtService,
    private sessionStorageService: SessionStorageService,
    private emailService: EmailService,
    private minioService: MinioService,
    private configService: ConfigService,
    private notificationsGateway: NotificationsGateway,
    private paymentsService: PaymentsService,
  ) { }

  async setExpoPushToken(userId: string, token: string) {
    const guide = await this.guideRepository.findOne({ where: { id: userId } });
    if (!guide) {
      throw new UnauthorizedException('Guide not found');
    }

    const normalized = String(token || '').trim();
    if (!normalized) {
      throw new BadRequestException('expoPushToken is required');
    }

    guide.expoPushToken = normalized;
    await this.guideRepository.save(guide);
    return { message: 'Expo push token updated' };
  }

  private async linkGuideToAgencyIfAgencyGuideExists(guide: Guide) {
    if (!guide?.email) return;

    const agencyGuide = await this.agencyGuideRepository.findOne({
      where: { email: guide.email.toLowerCase() },
    });

    if (!agencyGuide?.agencyId) return;

    if (guide.agencyId !== agencyGuide.agencyId) {
      guide.agencyId = agencyGuide.agencyId;
    }

    if (guide.primaryRole === GuideRole.AGENCY) {
      guide.primaryRole = GuideRole.FREELANCE;
    }

    if (guide.secondaryRole !== GuideRole.AGENCY) {
      guide.secondaryRole = GuideRole.AGENCY;
    }

    if (guide.activeRole !== GuideRole.AGENCY) {
      guide.activeRole = GuideRole.AGENCY;
    }

    await this.guideRepository.save(guide);
  }

  async joinAgency(guideId: string, agencyId: string): Promise<{ message: string; accessToken: string; guide: Partial<Guide> }> {
    const guide = await this.guideRepository.findOne({ where: { id: guideId } });
    if (!guide) {
      throw new UnauthorizedException('Guide not found');
    }

    const normalized = String(agencyId || '').trim();

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized);
    const agency = await this.adminAgenceRepository.findOne({
      where: isUuid ? [{ id: normalized }, { agencyCode: normalized.toUpperCase() }] : { agencyCode: normalized.toUpperCase() },
    });
    if (!agency) {
      throw new NotFoundException('Agency not found');
    }

    if (agency.status !== AdminAgenceStatus.ACTIVE) {
      throw new BadRequestException('Agency is not active');
    }

    guide.agencyId = agency.id;
    if (guide.primaryRole === GuideRole.AGENCY) {
      guide.primaryRole = GuideRole.FREELANCE;
    }
    if (guide.secondaryRole !== GuideRole.AGENCY) {
      guide.secondaryRole = GuideRole.AGENCY;
    }
    await this.guideRepository.save(guide);

    await this.linkGuideToAgencyIfAgencyGuideExists(guide);

    const { password, ...guideWithoutPassword } = guide as any;

    const payload = {
      sub: guide.id,
      email: guide.email,
      activeRole: guide.activeRole,
    };
    const accessToken = this.jwtService.sign(payload);

    return {
      message: 'Agency linked successfully',
      accessToken,
      guide: guideWithoutPassword,
    };
  }

  async signupStep1(signupStep1Dto: SignupStep1Dto): Promise<{ message: string; signupToken: string }> {
    const { email, phoneNumber, password, confirmPassword } = signupStep1Dto;

    if (password !== confirmPassword) {
      throw new BadRequestException('Passwords do not match');
    }

    const existingGuide = await this.guideRepository.findOne({
      where: [{ email }, { phoneNumber }],
    });

    if (existingGuide) {
      if (existingGuide.email === email) {
        throw new ConflictException('Email already exists');
      }
      if (existingGuide.phoneNumber === phoneNumber) {
        throw new ConflictException('Phone number already exists');
      }
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const step1Data: SignupSessionData = {
      email,
      phoneNumber,
      password: hashedPassword,
      step: 1,
      timestamp: Date.now(),
    };

    this.sessionStorageService.setSession(email, step1Data);
    const signupToken = this.sessionStorageService.generateSignupToken(email, 1);

    return {
      message: 'Step 1 completed successfully',
      signupToken,
    };
  }

  async signupStep2(signupToken: string, signupStep2Dto: SignupStep2Dto): Promise<{ message: string; signupToken: string }> {
    const tokenValidation = this.sessionStorageService.validateSignupToken(signupToken);
    if (!tokenValidation.valid || tokenValidation.step !== 1) {
      throw new BadRequestException('Invalid or expired token');
    }

    const sessionData = this.sessionStorageService.getSession<SignupSessionData>(tokenValidation.email!);
    if (!sessionData) {
      throw new BadRequestException('Session not found');
    }

    const step2Data = {
      ...sessionData,
      ...signupStep2Dto,
      step: 2,
    };

    this.sessionStorageService.setSession(tokenValidation.email!, step2Data);
    const newSignupToken = this.sessionStorageService.generateSignupToken(tokenValidation.email!, 2);

    return {
      message: 'Step 2 completed successfully',
      signupToken: newSignupToken,
    };
  }

  async signupStep3(signupToken: string, signupStep3Dto: SignupStep3Dto): Promise<{ message: string; accessToken: string; guide: Partial<Guide> }> {

    const tokenValidation = this.sessionStorageService.validateSignupToken(signupToken);
    if (!tokenValidation.valid || tokenValidation.step !== 2) {
      throw new BadRequestException('Invalid or expired token');
    }

    const sessionData = this.sessionStorageService.getSession<SignupSessionData>(tokenValidation.email!);
    if (!sessionData) {
      throw new BadRequestException('Session not found');
    }

    if (!signupStep3Dto.acceptTerms || !signupStep3Dto.acceptPrivacyPolicy) {
      throw new BadRequestException('You must accept terms and privacy policy');
    }

    const guide = this.guideRepository.create({
      email: sessionData.email!,
      phoneNumber: sessionData.phoneNumber!,
      password: sessionData.password!,
      firstName: sessionData.firstName!,
      lastName: sessionData.lastName!,
      dateOfBirth: new Date(sessionData.dateOfBirth!),
      gender: sessionData.gender as any,
      nationality: sessionData.nationality!,
      countryOfResidence: sessionData.countryOfResidence!,
      fullAddress: sessionData.fullAddress!,
      documentType: signupStep3Dto.documentType,
      documentNumber: signupStep3Dto.documentNumber,
      issuingCountry: signupStep3Dto.issuingCountry,
      documentExpiryDate: new Date(signupStep3Dto.documentExpiryDate),
      primaryRole: GuideRole.FREELANCE,
      activeRole: GuideRole.FREELANCE,
      status: GuideStatus.PENDING,
      hasAcceptedTerms: signupStep3Dto.acceptTerms,
      hasAcceptedPrivacyPolicy: signupStep3Dto.acceptPrivacyPolicy,
    });

    const savedGuide = await this.guideRepository.save(guide);
    await this.linkGuideToAgencyIfAgencyGuideExists(savedGuide);

    // Auto-create Stripe Connect account (non-blocking, ignore errors)
    setImmediate(async () => {
      try {
        await this.paymentsService.createStripeConnectAccountForOwner({
          ownerType: 'GUIDE',
          ownerId: savedGuide.id,
        });
      } catch {
        // ignore; Stripe Connect creation can be retried later
      }
    });

    // Envoyer email de bienvenue
    await this.emailService.sendWelcomeEmail(guide.email, guide.firstName);

    this.sessionStorageService.deleteSession(tokenValidation.email!);

    // Auto-login upon completion
    const payload = { 
        sub: savedGuide.id, 
        email: savedGuide.email, 
        activeRole: savedGuide.activeRole 
    };
    const accessToken = this.jwtService.sign(payload);

    const { password: _, ...guideWithoutPassword } = savedGuide as any;

    return {
      message: 'Registration completed successfully',
      accessToken,
      guide: guideWithoutPassword,
    };

  }

  async login(loginDto: LoginDto): Promise<{ accessToken: string; guide: Partial<Guide> }> {
    const { email, password } = loginDto;

    const normalizedEmail = email?.trim().toLowerCase();

    const guide = await this.guideRepository.findOne({
      where: { email: normalizedEmail },
      select: ['id', 'email', 'password', 'firstName', 'lastName', 'activeRole', 'primaryRole', 'secondaryRole', 'status', 'photo', 'bio', 'agencyId'],
    });

    if (!guide) {
      const agencyGuide = await this.agencyGuideRepository.findOne({ where: { email: normalizedEmail } });
      if (agencyGuide) {
        throw new UnauthorizedException(
          "Ce guide a été ajouté par une agence, mais le compte n'est pas encore activé. Veuillez faire une inscription (signup) ou utiliser 'Mot de passe oublié'.",
        );
      }
      throw new UnauthorizedException('Invalid credentials');
    }

    if (guide.status !== GuideStatus.ACTIVE && guide.status !== GuideStatus.PENDING) {
      throw new UnauthorizedException('Account is not active');
    }

    const isPasswordValid = await bcrypt.compare(password, guide.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    guide.lastLoginAt = new Date();

    // Activate account if it was pending
    if (guide.status === GuideStatus.PENDING) {
      guide.status = GuideStatus.ACTIVE;
    }

    await this.guideRepository.save(guide);

    const payload = {
      sub: guide.id,
      email: guide.email,
      activeRole: guide.activeRole,
    };

    const accessToken = this.jwtService.sign(payload);

    const { password: _, ...guideWithoutPassword } = guide;

    // Get signed URL for photo if exists
    let photoUrl: string | null = null;
    if (guide.photo) {
      try {
        photoUrl = await this.minioService.getFileUrl(
          this.configService.get<string>('MINIO_IMAGES_BUCKET_NAME') || 'images',
          guide.photo
        );
      } catch (err) {
        console.error('Failed to get photo URL:', err);
      }
    }

    return {
      accessToken,
      guide: {
        ...guideWithoutPassword,
        photoUrl,
        isProfileComplete: !!(guide.firstName && guide.lastName && guide.bio),
      } as any,
    };


    // After building the response, asynchronously check profile completeness
    // and send a WebSocket notification if needed.
  }

  private async checkAndNotifyProfileCompletion(guideId: string, guide: Guide): Promise<void> {
    const isComplete = !!(guide.firstName && guide.lastName);
    if (!isComplete) {
      // Small delay to let the client connect to the WebSocket first
      setTimeout(() => {
        this.notificationsGateway.sendProfileIncompleteNotification(guideId);
      }, 3000);
    }
  }


  async forgotPassword(forgotPasswordDto: ForgotPasswordDto): Promise<{ message: string; resetToken: string }> {
    const { email } = forgotPasswordDto;

    const guide = await this.guideRepository.findOne({
      where: { email },
    });

    if (!guide) {
      // Pour des raisons de sécurité, on ne révèle pas si l'email existe ou non
      return {
        message: 'If an account with this email exists, an OTP has been sent',
        resetToken: '',
      };
    }

    const otp = this.sessionStorageService.generateOtp();
    this.sessionStorageService.storeOtp(email, otp);

    // Générer un token de reset temporaire
    const resetToken = this.jwtService.sign(
      { email, type: 'password_reset' },
      { expiresIn: '15m' }
    );

    // Envoyer l'email avec l'OTP
    await this.emailService.sendOtpEmail(email, otp);

    return {
      message: 'If an account with this email exists, an OTP has been sent',
      resetToken,
    };
  }

  async verifyOtp(resetToken: string, verifyOtpDto: VerifyOtpDto): Promise<{ message: string; resetToken: string }> {
    const { otp } = verifyOtpDto;

    try {
      const decoded = this.jwtService.verify(resetToken);
      const email = decoded.email;

      if (decoded.type !== 'password_reset') {
        throw new BadRequestException('Invalid token type');
      }

      const isValid = this.sessionStorageService.verifyOtp(email, otp);

      if (!isValid) {
        throw new BadRequestException('Invalid or expired OTP');
      }

      // Nettoyer l'OTP après vérification
      this.sessionStorageService.clearOtp(email);

      return {
        message: 'OTP verified successfully',
        resetToken,
      };
    } catch (error) {
      throw new BadRequestException('Invalid or expired reset token');
    }
  }

  async changePassword(resetToken: string, changePasswordDto: ChangePasswordDto): Promise<{ message: string }> {
    const { newPassword, confirmPassword } = changePasswordDto;

    if (newPassword !== confirmPassword) {
      throw new BadRequestException('Passwords do not match');
    }

    if (newPassword.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters long');
    }

    try {
      const decoded = this.jwtService.verify(resetToken);
      const email = decoded.email;

      if (decoded.type !== 'password_reset') {
        throw new BadRequestException('Invalid token type');
      }

      const guide = await this.guideRepository.findOne({
        where: { email },
      });

      if (!guide) {
        throw new NotFoundException('User not found');
      }

      const hashedPassword = await bcrypt.hash(newPassword, 10);
      guide.password = hashedPassword;
      await this.guideRepository.save(guide);

      return {
        message: 'Password changed successfully',
      };
    } catch (error) {
      throw new BadRequestException('Invalid or expired reset token');
    }
  }

  async logout(guideId: string): Promise<{ message: string }> {
    // In a real-world application, you would:
    // 1. Add the token to a blacklist
    // 2. Or use Redis to store invalidated tokens
    // 3. Or use short-lived tokens with refresh tokens

    // For now, we'll just return a success message
    // The client should discard the JWT token
    return {
      message: 'Successfully logged out',
    };
  }

  async switchRole(guideId: string, switchRoleDto: SwitchRoleDto): Promise<{ message: string; accessToken: string; guide: Partial<Guide> }> {
    const { targetRole } = switchRoleDto;

    const guide = await this.guideRepository.findOne({
      where: { id: guideId },
    });

    if (!guide) {
      throw new UnauthorizedException('Guide not found');
    }

    // If switching to agency, try auto-linking by email to an AgencyGuide entry
    // (handles guides created via signup who were later added by an agency)
    if (targetRole === GuideRole.AGENCY) {
      await this.linkGuideToAgencyIfAgencyGuideExists(guide);
    }

    // If guide is already attached to an agency, allow enabling agency role on demand
    if (
      targetRole === GuideRole.AGENCY &&
      guide.secondaryRole !== GuideRole.AGENCY &&
      guide.primaryRole !== GuideRole.AGENCY
    ) {
      if (!guide.agencyId) {
        throw new BadRequestException('You must join an agency before switching to agency role');
      }
      guide.secondaryRole = GuideRole.AGENCY;
    }

    if (targetRole !== guide.primaryRole && targetRole !== guide.secondaryRole) {
      throw new BadRequestException(`You cannot switch to ${targetRole} role. Available roles: ${guide.primaryRole}${guide.secondaryRole ? ', ' + guide.secondaryRole : ''}`);
    }

    if (targetRole === GuideRole.AGENCY && !guide.agencyId) {
      throw new BadRequestException('You must join an agency before switching to agency role');
    }

    guide.activeRole = targetRole;
    await this.guideRepository.save(guide);

    const { password, ...guideWithoutPassword } = guide;

    const payload = {
      sub: guide.id,
      email: guide.email,
      activeRole: guide.activeRole,
    };
    const accessToken = this.jwtService.sign(payload);

    return {
      message: `Successfully switched to ${targetRole} role`,
      accessToken,
      guide: guideWithoutPassword,
    };
  }

  async addSecondaryRole(guideId: string, secondaryRole: GuideRole): Promise<{ message: string; guide: Partial<Guide> }> {
    const guide = await this.guideRepository.findOne({
      where: { id: guideId },
    });

    if (!guide) {
      throw new UnauthorizedException('Guide not found');
    }

    if (secondaryRole === guide.primaryRole) {
      throw new BadRequestException('This is already your primary role');
    }

    if (guide.secondaryRole) {
      throw new BadRequestException('You already have a secondary role');
    }

    guide.secondaryRole = secondaryRole;
    await this.guideRepository.save(guide);

    const { password, ...guideWithoutPassword } = guide;

    return {
      message: `Secondary role ${secondaryRole} added successfully`,
      guide: guideWithoutPassword,
    };
  }

  async getProfile(guideId: string): Promise<Partial<Guide> & { photoUrl?: string; isProfileComplete: boolean }> {
    const guide = await this.guideRepository.findOne({
      where: { id: guideId },
      select: ['id', 'email', 'firstName', 'lastName', 'phoneNumber', 'activeRole', 'primaryRole', 'secondaryRole', 'status', 'lastLoginAt', 'createdAt', 'photo', 'bio', 'dateOfBirth', 'languages', 'uniqueIdentifier', 'specialties', 'experience', 'pricePerDay', 'location', 'nationality', 'countryOfResidence', 'fullAddress', 'isVisible', 'agencyId'],


    });

    if (!guide) {
      throw new UnauthorizedException('Guide not found');
    }

    let photoUrl: string | null = null;
    if (guide.photo) {
      try {
        photoUrl = await this.minioService.getFileUrl(
          this.configService.get<string>('MINIO_IMAGES_BUCKET_NAME') || 'images',
          guide.photo
        );
      } catch (err) {
        console.error('Failed to get photo URL for profile:', err);
      }
    }

    const isProfileComplete = !!(
      guide.firstName && 
      guide.lastName && 
      guide.bio && 
      guide.languages?.length > 0 && 
      guide.location && 
      guide.dateOfBirth
    );


    // Notify via WebSocket if profile is incomplete (with cooldown)
    if (!isProfileComplete) {
      if (this.sessionStorageService.shouldSendNotification(guideId)) {
        this.sessionStorageService.setNotificationSent(guideId);
        setTimeout(() => {
          this.notificationsGateway.sendProfileIncompleteNotification(guideId);
        }, 2000);
      }
    }


    const { photo, ...guideWithoutRawPhoto } = guide as any;
    return { ...guideWithoutRawPhoto, photoUrl, isProfileComplete };
  }

  async updateProfile(guideId: string, updateProfileDto: any): Promise<Partial<Guide>> {
    const guide = await this.guideRepository.findOne({
      where: { id: guideId },
    });

    if (!guide) {
      throw new NotFoundException('Guide not found');
    }

    // Freelance compliance gating: do not allow making profile visible until required steps are completed.
    if (Object.prototype.hasOwnProperty.call(updateProfileDto || {}, 'isVisible')) {
      const nextVisible = Boolean((updateProfileDto as any).isVisible);
      const isFreelance = String(guide?.activeRole || '') === GuideRole.FREELANCE;
      if (isFreelance && nextVisible) {
        const now = Date.now();
        const documentsDone = !!(
          guide.freelanceDocumentsUploadedAt &&
          Array.isArray(guide.freelanceDocuments) &&
          guide.freelanceDocuments.length > 0
        );
        const emailDone = !!guide.isEmailVerified;
        const contractDone = !!(
          guide.freelanceContractPdfKey &&
          guide.freelanceContractExpiresAt &&
          new Date(guide.freelanceContractExpiresAt).getTime() > now
        );
        if (!(documentsDone && emailDone && contractDone)) {
          throw new BadRequestException('Complete documents upload, email verification and contract signature before making your profile visible.');
        }
      }
    }

    // Mise à jour des champs
    Object.assign(guide, updateProfileDto);

    await this.guideRepository.save(guide);

    const { password, ...guideWithoutPassword } = guide;
    return guideWithoutPassword;
  }

  async findAllActiveGuides(search?: string, role?: GuideRole): Promise<any[]> {
    const query = this.guideRepository.createQueryBuilder('guide')
      .where('guide.status = :status', { status: GuideStatus.ACTIVE })
      .andWhere('guide.isVisible = :visible', { visible: true })
      .select([
        'guide.id',
        'guide.firstName',
        'guide.lastName',
        'guide.photo',
        'guide.languages',
        'guide.experience',
        'guide.pricePerDay',
        'guide.location',
        'guide.specialties',
        'guide.bio',
        'guide.activeRole',
        'guide.primaryRole',
        'guide.secondaryRole',
        'guide.isEmailVerified',
        'guide.freelanceDocumentsUploadedAt',
        'guide.freelanceDocuments',
        'guide.freelanceContractPdfKey',
        'guide.freelanceContractExpiresAt',
      ]);

    if (search) {
      query.andWhere(
        '(guide.firstName ILIKE :search OR guide.lastName ILIKE :search OR guide.languages ILIKE :search)',
        { search: `%${search}%` }
      );
    }

    if (role) {
      query.andWhere(
        '("guide"."activeRole"::text = :role OR "guide"."primaryRole"::text = :role OR "guide"."secondaryRole"::text = :role)',
        { role },
      );
    }

    const guides = await query.getMany();

    // Compliance gating (freelance only): if steps not completed, the profile is not visible to pilgrims.
    const now = Date.now();
    const gatedGuides = guides.filter((g: any) => {
      const isFreelance =
        String(g?.activeRole || '') === GuideRole.FREELANCE ||
        String(g?.primaryRole || '') === GuideRole.FREELANCE ||
        String(g?.secondaryRole || '') === GuideRole.FREELANCE;
      if (!isFreelance) return true;

      const documentsDone = !!(g?.freelanceDocumentsUploadedAt && Array.isArray(g?.freelanceDocuments) && g.freelanceDocuments.length > 0);
      const emailDone = !!g?.isEmailVerified;
      const contractDone = !!(
        g?.freelanceContractPdfKey &&
        g?.freelanceContractExpiresAt &&
        new Date(g.freelanceContractExpiresAt).getTime() > now
      );
      return documentsDone && emailDone && contractDone;
    });

    // Map to include photoUrl
    return Promise.all(gatedGuides.map(async (guide) => {
      let photoUrl: string | null = null;
      if (guide.photo) {
        try {
          photoUrl = await this.minioService.getFileUrl(
            this.configService.get<string>('MINIO_IMAGES_BUCKET_NAME') || 'images',
            guide.photo
          );
        } catch (err) {}
      }
      const { photo, ...rest } = guide as any;
      return { ...rest, photoUrl };
    }));
  }



  async deleteAccount(guideId: string, deleteAccountDto: DeleteAccountDto): Promise<{ message: string }> {
    const guide = await this.guideRepository.findOne({
      where: { id: guideId },
      select: ['id', 'email', 'password'],
    });

    if (!guide) {
      throw new NotFoundException('Guide not found');
    }

    const isPasswordValid = await bcrypt.compare(deleteAccountDto.password, guide.password);
    if (!isPasswordValid) {
      throw new BadRequestException('Incorrect password. Account deletion aborted.');
    }

    // Supprimer le guide de la base de données
    await this.guideRepository.remove(guide);

    // Nettoyer les sessions éventuelles
    this.sessionStorageService.deleteSession(guide.email);

    return {
      message: 'Account deleted successfully',
    };
  }




  async uploadAvatar(guideId: string, file: any): Promise<{ photoUrl: string }> {
    const guide = await this.guideRepository.findOne({ where: { id: guideId } });
    if (!guide) throw new NotFoundException('Guide not found');

    const bucketName = this.configService.get<string>('MINIO_IMAGES_BUCKET_NAME') || 'images';
    const fileName = `avatars/${guideId}-${Date.now()}`;

    await this.minioService.uploadFile(
      bucketName,
      fileName,
      file.buffer,
      file.mimetype
    );

    // Supprimer l'ancienne photo si elle existe
    if (guide.photo) {
      try {
        await this.minioService.deleteFile(bucketName, guide.photo);
      } catch (err) {
        console.error('Failed to delete old photo:', err);
      }
    }

    guide.photo = fileName;
    await this.guideRepository.save(guide);

    const photoUrl = await this.minioService.getFileUrl(bucketName, fileName);
    return { photoUrl };
  }
}
