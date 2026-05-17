import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { Repository } from 'typeorm';
import { MinioService } from '../../minio/minio.service';
import { AdminAgenceEmailService } from './services/email.service';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import { AdminAgenceUser } from './entities/admin-agence-user.entity';
import { AgencyGuide } from '../guide/entities/guide.entity';
import { PackUmrah, PackUmrahStatus } from '../pack_umrah/entities/pack-umrah.entity';
import {
  AdminAgenceRole,
  AdminAgenceStatus,
} from './entities/admin-agence-user.entity';
import { SignupAgenceDto } from './dto/signup-agence.dto';
import { LoginAdminAgenceDto } from './dto/login-admin-agence.dto';
import { CreateSubAdminDto } from './dto/create-sub-admin.dto';
import { BootstrapAdminDto } from './dto/bootstrap-admin.dto';
import { CompleteAgencyProfileDto } from './dto/complete-agency-profile.dto';
import { PaymentsService } from '../../payments/payments.service';

const PRIMARY_ADMIN_PERMISSIONS = [
  'Voir Wallet & Finances',
  'Gestion des Agences',
  'Gestion des Guides',
  'Ajout/Modération Admins',
  'Consulter SOS Alerts',
];
const DOCUMENTS_BUCKET = 'documents';
const IMAGES_BUCKET = 'images';

@Injectable()
export class AdminAgenceAuthService {
  constructor(
    @InjectRepository(AdminAgenceUser)
    private readonly adminAgenceUserRepository: Repository<AdminAgenceUser>,
    @InjectRepository(AgencyGuide)
    private readonly agencyGuideRepository: Repository<AgencyGuide>,
    @InjectRepository(PackUmrah)
    private readonly packRepository: Repository<PackUmrah>,
    private readonly jwtService: JwtService,
    private readonly minioService: MinioService,
    private readonly adminAgenceEmailService: AdminAgenceEmailService,
    private readonly paymentsService: PaymentsService,
  ) { }

  async signupAgence(signupAgenceDto: SignupAgenceDto) {
    const { email, acceptedTerms } = signupAgenceDto;

    if (!acceptedTerms) {
      throw new BadRequestException('Terms must be accepted');
    }

    const existingUser = await this.adminAgenceUserRepository.findOne({ where: { email } });
    if (existingUser) {
      throw new ConflictException('Email already exists');
    }

    const agencyCode = await this.generateUniqueAgencyCode(signupAgenceDto?.agencyName || signupAgenceDto?.fullName || 'AG');

    const agenceUser = this.adminAgenceUserRepository.create({
      ...signupAgenceDto,
      agencyCode,
      activeRole: AdminAgenceRole.AGENCE,
      status: AdminAgenceStatus.PENDING,
      permissions: ['agency_portal_access'],
    } as Partial<AdminAgenceUser>);

    const savedUser = await this.adminAgenceUserRepository.save(agenceUser);
    const accessToken = this.generateToken(savedUser);

    // Auto-create Stripe Connect account (non-blocking, ignore errors)
    setImmediate(async () => {
      try {
        await this.paymentsService.createStripeConnectAccountForOwner({
          ownerType: 'AGENCY',
          ownerId: savedUser.id,
        });
      } catch {
        // ignore; Stripe Connect creation can be retried later
      }
    });

    return {
      message: 'Agence account created successfully',
      accessToken,
      user: this.sanitizeUser(savedUser),
    };
  }

  async bootstrapAdmin(bootstrapAdminDto: BootstrapAdminDto) {
    const primaryAdmin = await this.adminAgenceUserRepository.findOne({
      where: { activeRole: AdminAgenceRole.ADMIN, isPrimaryAdmin: true },
    });

    if (primaryAdmin) {
      throw new ForbiddenException('Primary admin already exists');
    }

    const existingUser = await this.adminAgenceUserRepository.findOne({
      where: { email: bootstrapAdminDto.email },
    });

    if (existingUser) {
      throw new ConflictException('Email already exists');
    }

    const admin = this.adminAgenceUserRepository.create({
      fullName: bootstrapAdminDto.fullName,
      email: bootstrapAdminDto.email,
      password: bootstrapAdminDto.password,
      phoneNumber: bootstrapAdminDto.phoneNumber,
      activeRole: AdminAgenceRole.ADMIN,
      status: AdminAgenceStatus.ACTIVE,
      isPrimaryAdmin: true,
      permissions: PRIMARY_ADMIN_PERMISSIONS,
    });

    const savedAdmin = await this.adminAgenceUserRepository.save(admin);

    return {
      message: 'Primary admin created successfully',
      accessToken: this.generateToken(savedAdmin),
      user: this.sanitizeUser(savedAdmin),
    };
  }

  async login(loginDto: LoginAdminAgenceDto) {
    const { email, password } = loginDto;

    if (!email || !password) {
      throw new UnauthorizedException('Email and password are required');
    }

    const user = await this.adminAgenceUserRepository.findOne({
      where: { email },
      select: [
        'id',
        'email',
        'password',
        'fullName',
        'phoneNumber',
        'agencyName',
        'agencyLicense',
        'profileCompletionSubmitted',
        'activeRole',
        'status',
        'permissions',
        'isPrimaryAdmin',
        'createdById',
        'lastLoginAt',
        'isTwoFactorEnabled',
        'twoFactorSecret',
        'createdAt',
        'updatedAt',
      ],
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.status === AdminAgenceStatus.SUSPENDED) {
      throw new ForbiddenException('Account suspended');
    }

    if (!user.password) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.activeRole === AdminAgenceRole.ADMIN || user.activeRole === AdminAgenceRole.SUB_ADMIN) {
      if (user.status !== AdminAgenceStatus.ACTIVE) {
        throw new ForbiddenException('Admin account must be activated manually');
      }
    }

    user.lastLoginAt = new Date();
    await this.adminAgenceUserRepository.save(user);

    console.log('--- LOGIN DEBUG ---');
    console.log('Email:', user.email);
    console.log('isTwoFactorEnabled:', user.isTwoFactorEnabled);
    console.log('twoFactorSecret exists:', !!user.twoFactorSecret);
    console.log('-------------------');

    if (user.isTwoFactorEnabled) {
      return {
        mfaRequired: true,
        userId: user.id,
      };
    }

    return {
      accessToken: this.generateToken(user),
      user: this.sanitizeUser(user),
    };
  }

  async generateTwoFactorSecret(userId: string) {
    const user = await this.adminAgenceUserRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const secret = authenticator.generateSecret();
    const otpauthUrl = authenticator.keyuri(user.email, 'Sabeel Platform', secret);
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);

    user.twoFactorSecret = secret;
    await this.adminAgenceUserRepository.save(user);

    return {
      secret,
      qrCodeDataUrl,
    };
  }

  async enableTwoFactor(userId: string, code: string) {
    const user = await this.adminAgenceUserRepository.findOne({ where: { id: userId } });
    if (!user || !user.twoFactorSecret) {
      throw new BadRequestException('2FA secret not generated');
    }

    const isValid = authenticator.verify({
      token: code,
      secret: user.twoFactorSecret,
    });

    if (!isValid) {
      throw new BadRequestException('Invalid verification code');
    }

    user.isTwoFactorEnabled = true;
    await this.adminAgenceUserRepository.save(user);

    return { message: '2FA enabled successfully' };
  }

  async disableTwoFactor(userId: string) {
    const user = await this.adminAgenceUserRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    user.isTwoFactorEnabled = false;
    user.twoFactorSecret = null;
    await this.adminAgenceUserRepository.save(user);

    return { message: '2FA disabled successfully' };
  }

  async verifyTwoFactorLogin(userId: string, code: string) {
    const user = await this.adminAgenceUserRepository.findOne({ where: { id: userId } });
    console.log('[AdminAuth] verifyTwoFactorLogin attempt', {
      userId,
      userFound: Boolean(user),
      isTwoFactorEnabled: user?.isTwoFactorEnabled,
      hasTwoFactorSecret: Boolean(user?.twoFactorSecret),
      activeRole: user?.activeRole,
      status: user?.status,
    });
    if (!user || !user.isTwoFactorEnabled || !user.twoFactorSecret) {
      throw new UnauthorizedException('2FA not enabled for this user');
    }

    const isValid = authenticator.verify({
      token: code,
      secret: user.twoFactorSecret,
    });

    if (!isValid) {
      console.warn('[AdminAuth] verifyTwoFactorLogin invalid code', {
        userId,
      });
      throw new UnauthorizedException('Invalid 2FA code');
    }

    const accessToken = this.generateToken(user);
    console.log('[AdminAuth] verifyTwoFactorLogin success', {
      userId,
      activeRole: user.activeRole,
      status: user.status,
      tokenPreview: accessToken.slice(0, 20),
    });

    return {
      accessToken,
      user: this.sanitizeUser(user),
    };
  }

  async getProfile(userId: string) {
    console.log('[AdminAuth] getProfile request', { userId });
    const user = await this.adminAgenceUserRepository.findOne({ where: { id: userId } });
    if (!user) {
      console.warn('[AdminAuth] getProfile user not found', { userId });
      throw new NotFoundException('User not found');
    }

    console.log('[AdminAuth] getProfile success', {
      userId,
      activeRole: user.activeRole,
      status: user.status,
      profileCompletionSubmitted: user.profileCompletionSubmitted,
    });

    return {
      user: await this.buildUserResponse(user),
    };
  }

  async listPublicAgencies() {
    const agencies = await this.adminAgenceUserRepository.find({
      where: {
        activeRole: AdminAgenceRole.AGENCE,
        status: AdminAgenceStatus.ACTIVE,
      },
      order: { updatedAt: 'DESC' },
    });

    // Backfill missing codes for older agencies
    try {
      for (const agency of agencies) {
        await this.ensureAgencyCode(agency);
      }
    } catch {
      // ignore
    }

    return {
      agencies: agencies.map((agency) => ({
        id: agency.id,
        agencyCode: agency.agencyCode || null,
        name: agency.agencyName || agency.fullName || '',
        profileImageUrl: agency.profileImagePath
          ? this.minioService.getPublicFileUrl(IMAGES_BUCKET, agency.profileImagePath)
          : null,
      })),
    };
  }

  async getPublicAgencyById(agencyId: string) {
    const agency = await this.adminAgenceUserRepository.findOne({ where: { id: agencyId } });
    if (!agency || agency.activeRole !== AdminAgenceRole.AGENCE) {
      throw new NotFoundException('Agency not found');
    }

    await this.ensureAgencyCode(agency);

    const packs = await this.packRepository.find({
      where: {
        agencyId,
        status: PackUmrahStatus.APPROVED,
        isVisible: true,
        isArchived: false,
      },
      order: { createdAt: 'DESC' },
    });

    return {
      agency: {
        id: agency.id,
        agencyCode: agency.agencyCode || null,
        name: agency.agencyName || agency.fullName || '',
        fullName: agency.fullName || '',
        phoneNumber: agency.phoneNumber || '',
        email: agency.email || '',
        agencyType: agency.agencyType || '',
        responsibleName: agency.responsibleName || '',
        responsibleTitle: agency.responsibleTitle || '',
        profileImageUrl: agency.profileImagePath
          ? this.minioService.getPublicFileUrl(IMAGES_BUCKET, agency.profileImagePath)
          : null,
        coverImageUrl: agency.coverImagePath
          ? this.minioService.getPublicFileUrl(IMAGES_BUCKET, agency.coverImagePath)
          : null,
        packsCount: packs.length,
      },
      packs: packs.map((pack) => ({
        id: pack.id,
        title: pack.title,
        departureDate: pack.departureDate,
        arrivalDate: pack.arrivalDate,
        price: pack.price,
        priceAdult: pack.priceAdult,
        imageUrl: pack.imageUrl ? this.minioService.getPublicFileUrl(IMAGES_BUCKET, pack.imageUrl) : null,
        description: pack.description || '',
      })),
    };
  }

  async uploadProfileImage(userId: string, file: any) {
    if (!file) {
      throw new BadRequestException('File is required');
    }

    const user = await this.adminAgenceUserRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const agencyFolder = this.buildAgencyFolderName(user.agencyName || user.fullName || user.id);
    const objectPath = `${agencyFolder}/profile/${this.createStoredFileName('profile', file.originalname)}`;
    await this.minioService.uploadFile(IMAGES_BUCKET, objectPath, file.buffer, file.mimetype);

    user.profileImagePath = objectPath;
    const saved = await this.adminAgenceUserRepository.save(user);

    return {
      message: 'Profile image uploaded successfully',
      user: await this.buildUserResponse(saved),
    };
  }

  async uploadCoverImage(userId: string, file: any) {
    if (!file) {
      throw new BadRequestException('File is required');
    }

    const user = await this.adminAgenceUserRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const agencyFolder = this.buildAgencyFolderName(user.agencyName || user.fullName || user.id);
    const objectPath = `${agencyFolder}/cover/${this.createStoredFileName('cover', file.originalname)}`;
    await this.minioService.uploadFile(IMAGES_BUCKET, objectPath, file.buffer, file.mimetype);

    user.coverImagePath = objectPath;
    const saved = await this.adminAgenceUserRepository.save(user);

    return {
      message: 'Cover image uploaded successfully',
      user: await this.buildUserResponse(saved),
    };
  }

  async completeAgencyProfile(
    currentUser: { userId: string; activeRole: string },
    dto: CompleteAgencyProfileDto,
    files: {
      documents?: any[];
      contract?: any[];
    },
  ) {
    if (currentUser.activeRole !== AdminAgenceRole.AGENCE) {
      throw new ForbiddenException('Only agencies can complete this profile');
    }

    const agencyUser = await this.adminAgenceUserRepository.findOne({ where: { id: currentUser.userId } });
    if (!agencyUser) {
      throw new NotFoundException('Agency not found');
    }

    const uploadedDocuments = files?.documents || [];
    const contractFile = files?.contract?.[0];

    if (!uploadedDocuments.length) {
      throw new BadRequestException('At least one document is required');
    }

    if (!contractFile) {
      throw new BadRequestException('Contract file is required');
    }

    const agencyFolder = this.buildAgencyFolderName(agencyUser.agencyName || agencyUser.fullName || agencyUser.id);
    const documentLabels = this.parseDocumentLabels(dto.documentLabels, uploadedDocuments.length);

    const agencyDocuments = await Promise.all(
      uploadedDocuments.map(async (file, index) => {
        const label = documentLabels[index] || `document-${index + 1}`;
        const objectPath = `${agencyFolder}/documents/${this.createStoredFileName(label, file.originalname)}`;
        await this.minioService.uploadFile(DOCUMENTS_BUCKET, objectPath, file.buffer, file.mimetype);
        return {
          label,
          path: objectPath,
          fileName: file.originalname,
        };
      }),
    );

    const contractFilePath = `${agencyFolder}/contract/${this.createStoredFileName(
      dto.contractFileName || 'contract',
      contractFile.originalname,
    )}`;
    await this.minioService.uploadFile(
      DOCUMENTS_BUCKET,
      contractFilePath,
      contractFile.buffer,
      contractFile.mimetype,
    );

    agencyUser.agencyType = dto.agencyType || agencyUser.agencyType;
    agencyUser.responsibleName = dto.responsibleName || agencyUser.responsibleName || agencyUser.fullName;
    agencyUser.responsibleTitle = dto.responsibleTitle || agencyUser.responsibleTitle;
    agencyUser.contractDuration = dto.contractDuration ? Number(dto.contractDuration) : agencyUser.contractDuration;
    agencyUser.contractStartDate = new Date();
    agencyUser.contractEndDate = this.calculateContractEndDate(agencyUser.contractStartDate, agencyUser.contractDuration || 12);
    agencyUser.agencyDocuments = agencyDocuments;
    agencyUser.contractFilePath = contractFilePath;
    agencyUser.contractFileName = contractFile.originalname;
    agencyUser.profileCompletionSubmitted = true;
    agencyUser.status = AdminAgenceStatus.PENDING;

    const savedUser = await this.adminAgenceUserRepository.save(agencyUser);
    await this.adminAgenceEmailService.sendAgencySubmissionReceivedEmail({
      email: savedUser.email,
      agencyName: savedUser.agencyName || savedUser.fullName,
      responsibleName: savedUser.responsibleName || savedUser.fullName,
      contractEndDate: savedUser.contractEndDate?.toLocaleDateString('fr-FR'),
    });

    return {
      message: 'Agency profile submitted successfully and is pending verification',
      user: await this.buildUserResponse(savedUser),
    };
  }

  async getAgencySubmissions(currentUser: { userId: string; activeRole: string }) {
    if (![AdminAgenceRole.ADMIN, AdminAgenceRole.SUB_ADMIN].includes(currentUser.activeRole as AdminAgenceRole)) {
      throw new ForbiddenException('Only admins can view agency submissions');
    }

    const agencies = await this.adminAgenceUserRepository.find({
      where: { activeRole: AdminAgenceRole.AGENCE },
      order: { updatedAt: 'DESC' },
    });

    return {
      agencies: await Promise.all(agencies.map((agency) => this.buildUserResponse(agency))),
    };
  }

  async getAgencyById(currentUser: { userId: string; activeRole: string }, agencyId: string) {
    if (![AdminAgenceRole.ADMIN, AdminAgenceRole.SUB_ADMIN].includes(currentUser.activeRole as AdminAgenceRole)) {
      throw new ForbiddenException('Only admins can view agency dossiers');
    }

    const agency = await this.adminAgenceUserRepository.findOne({
      where: { id: agencyId, activeRole: AdminAgenceRole.AGENCE },
    });

    if (!agency) {
      throw new NotFoundException('Agency not found');
    }

    return {
      agency: await this.buildUserResponse(agency),
    };
  }

  async verifyAgencySubmission(currentUser: { userId: string; activeRole: string }, agencyId: string) {
    if (![AdminAgenceRole.ADMIN, AdminAgenceRole.SUB_ADMIN].includes(currentUser.activeRole as AdminAgenceRole)) {
      throw new ForbiddenException('Only admins can verify agency submissions');
    }

    const agency = await this.adminAgenceUserRepository.findOne({
      where: { id: agencyId, activeRole: AdminAgenceRole.AGENCE },
    });

    if (!agency) {
      throw new NotFoundException('Agency submission not found');
    }

    if (!agency.profileCompletionSubmitted) {
      throw new BadRequestException('Agency has not submitted documents yet');
    }

    agency.status = AdminAgenceStatus.ACTIVE;
    const savedAgency = await this.adminAgenceUserRepository.save(agency);
    await this.adminAgenceEmailService.sendAgencyApprovedEmail({
      email: savedAgency.email,
      agencyName: savedAgency.agencyName || savedAgency.fullName,
      responsibleName: savedAgency.responsibleName || savedAgency.fullName,
    });

    return {
      message: 'Agency verified successfully',
      user: await this.buildUserResponse(savedAgency),
    };
  }

  async rejectAgencySubmission(currentUser: { userId: string; activeRole: string }, agencyId: string) {
    if (![AdminAgenceRole.ADMIN, AdminAgenceRole.SUB_ADMIN].includes(currentUser.activeRole as AdminAgenceRole)) {
      throw new ForbiddenException('Only admins can reject agency submissions');
    }

    const agency = await this.adminAgenceUserRepository.findOne({
      where: { id: agencyId, activeRole: AdminAgenceRole.AGENCE },
    });

    if (!agency) {
      throw new NotFoundException('Agency submission not found');
    }

    agency.status = AdminAgenceStatus.REFUSED;
    const savedAgency = await this.adminAgenceUserRepository.save(agency);
    await this.adminAgenceEmailService.sendAgencyRejectedEmail({
      email: savedAgency.email,
      agencyName: savedAgency.agencyName || savedAgency.fullName,
      responsibleName: savedAgency.responsibleName || savedAgency.fullName,
      reason: 'Your submission has been rejected',
    });

    return {
      message: 'Agency rejected successfully',
      user: await this.buildUserResponse(savedAgency),
    };
  }

  async createSubAdmin(currentUser: { userId: string; activeRole: string }, dto: CreateSubAdminDto) {
    if (currentUser.activeRole !== AdminAgenceRole.ADMIN) {
      throw new ForbiddenException('Only primary admin can create sub admins');
    }

    const creator = await this.adminAgenceUserRepository.findOne({ where: { id: currentUser.userId } });
    if (!creator || !creator.isPrimaryAdmin) {
      throw new ForbiddenException('Only primary admin can create sub admins');
    }

    const existingUser = await this.adminAgenceUserRepository.findOne({ where: { email: dto.email } });
    if (existingUser) {
      throw new ConflictException('Email already exists');
    }

    const subAdmin = this.adminAgenceUserRepository.create({
      email: dto.email,
      password: dto.password,
      fullName: dto.fullName,
      permissions: dto.permissions || [],
      activeRole: AdminAgenceRole.SUB_ADMIN,
      status: AdminAgenceStatus.ACTIVE,
      createdById: creator.id,
      isPrimaryAdmin: false,
    });

    const savedUser = await this.adminAgenceUserRepository.save(subAdmin);

    return {
      message: 'Sub admin created successfully',
      user: this.sanitizeUser(savedUser),
    };
  }

  async forgotPassword(email: string) {
    const user = await this.adminAgenceUserRepository.findOne({ where: { email } });
    if (!user) {
      throw new NotFoundException('Utilisateur non trouvé avec cet email');
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = new Date();
    expires.setMinutes(expires.getMinutes() + 15); // 15 minutes expiry

    user.resetPasswordOtp = otp;
    user.resetPasswordExpires = expires;
    await this.adminAgenceUserRepository.save(user);

    await this.adminAgenceEmailService.sendOtpEmail(email, otp);

    return {
      message: 'Un code OTP a été envoyé à votre adresse email',
    };
  }

  async verifyOtp(email: string, otp: string) {
    const user = await this.adminAgenceUserRepository.findOne({ where: { email } });
    if (!user) {
      throw new NotFoundException('Utilisateur non trouvé');
    }

    if (!user.resetPasswordOtp || user.resetPasswordOtp !== otp) {
      throw new BadRequestException('Code OTP invalide');
    }

    if (!user.resetPasswordExpires || user.resetPasswordExpires.getTime() < Date.now()) {
      throw new BadRequestException('Code OTP expiré');
    }

    return {
      message: 'Code OTP vérifié avec succès',
    };
  }

  async resetPassword(email: string, otp: string, newPassword: string) {
    const user = await this.adminAgenceUserRepository.findOne({ where: { email } });
    if (!user) {
      throw new NotFoundException('Utilisateur non trouvé');
    }

    if (!user.resetPasswordOtp || user.resetPasswordOtp !== otp) {
      throw new BadRequestException('Code OTP invalide');
    }

    if (!user.resetPasswordExpires || user.resetPasswordExpires.getTime() < Date.now()) {
      throw new BadRequestException('Code OTP expiré');
    }

    user.password = await bcrypt.hash(newPassword, 10);
    user.resetPasswordOtp = null;
    user.resetPasswordExpires = null;
    await this.adminAgenceUserRepository.save(user);

    return {
      message: 'Votre mot de passe a été réinitialisé avec succès',
    };
  }

  async changePassword(userId: string, oldPass: string, newPass: string) {
    const user = await this.adminAgenceUserRepository.findOne({
      where: { id: userId },
      select: ['id', 'password'],
    });

    if (!user) throw new NotFoundException('User not found');

    const isValid = await bcrypt.compare(oldPass, user.password);
    if (!isValid) throw new BadRequestException('Ancien mot de passe incorrect');

    user.password = await bcrypt.hash(newPass, 10);
    await this.adminAgenceUserRepository.save(user);

    return { message: 'Mot de passe mis à jour avec succès' };
  }

  async listAdmins(currentUser: { userId: string; activeRole: string }) {
    if (
      ![AdminAgenceRole.ADMIN, AdminAgenceRole.SUB_ADMIN].includes(
        currentUser.activeRole as AdminAgenceRole,
      )
    ) {
      throw new ForbiddenException('Only admins can view the admin list');
    }

    const admins = await this.adminAgenceUserRepository.find({
      where: [{ activeRole: AdminAgenceRole.ADMIN }, { activeRole: AdminAgenceRole.SUB_ADMIN }],
      order: { createdAt: 'DESC' },
    });

    return {
      admins: await Promise.all(admins.map((admin) => this.buildUserResponse(admin))),
    };
  }

  async updateSubAdmin(
    currentUser: { userId: string; activeRole: string },
    adminId: string,
    dto: any,
  ) {
    if (currentUser.activeRole !== AdminAgenceRole.ADMIN) {
      throw new ForbiddenException('Only primary admin can update admins');
    }

    const creator = await this.adminAgenceUserRepository.findOne({
      where: { id: currentUser.userId },
    });
    if (!creator || !creator.isPrimaryAdmin) {
      throw new ForbiddenException('Only primary admin can update admins');
    }

    const admin = await this.adminAgenceUserRepository.findOne({ where: { id: adminId } });
    if (!admin) {
      throw new NotFoundException('Admin not found');
    }

    if (admin.isPrimaryAdmin && admin.id !== creator.id) {
      throw new ForbiddenException('Cannot modify another primary admin');
    }

    if (dto.fullName) admin.fullName = dto.fullName;
    if (dto.email) admin.email = dto.email;
    if (dto.permissions) admin.permissions = dto.permissions;
    if (dto.password) {
      admin.password = await bcrypt.hash(dto.password, 10);
    }

    const saved = await this.adminAgenceUserRepository.save(admin);
    return {
      message: 'Admin updated successfully',
      user: this.sanitizeUser(saved),
    };
  }

  async deleteSubAdmin(currentUser: { userId: string; activeRole: string }, adminId: string) {
    if (currentUser.activeRole !== AdminAgenceRole.ADMIN) {
      throw new ForbiddenException('Only primary admin can delete admins');
    }

    const creator = await this.adminAgenceUserRepository.findOne({
      where: { id: currentUser.userId },
    });
    if (!creator || !creator.isPrimaryAdmin) {
      throw new ForbiddenException('Only primary admin can delete admins');
    }

    const admin = await this.adminAgenceUserRepository.findOne({ where: { id: adminId } });
    if (!admin) {
      throw new NotFoundException('Admin not found');
    }

    if (admin.isPrimaryAdmin) {
      throw new ForbiddenException('Cannot delete primary admin');
    }

    await this.adminAgenceUserRepository.remove(admin);
    return { message: 'Admin deleted successfully' };
  }

  private generateToken(user: AdminAgenceUser) {
    return this.jwtService.sign({
      sub: user.id,
      email: user.email,
      activeRole: user.activeRole,
    });
  }

  private async buildUserResponse(user: AdminAgenceUser) {
    await this.ensureAgencyCode(user);

    const guidesCount =
      user.activeRole === AdminAgenceRole.AGENCE
        ? await this.agencyGuideRepository.count({ where: { agencyId: user.id } })
        : 0;

    const safeUser = this.sanitizeUser(user) as AdminAgenceUser & {
      agencyDocuments?: { label: string; path: string; fileName: string; url?: string }[];
      contractFileUrl?: string;
      contractFileName?: string;
      profileImageUrl?: string;
      coverImageUrl?: string;
      contractExpired?: boolean;
      guidesCount?: number;
      isTwoFactorEnabled?: boolean;
    };

    safeUser.guidesCount = guidesCount;
    safeUser.isTwoFactorEnabled = user.isTwoFactorEnabled;

    if (safeUser.agencyDocuments?.length) {
      safeUser.agencyDocuments = await Promise.all(
        safeUser.agencyDocuments.map(async (document) => ({
          ...document,
          url: await this.minioService.getFileUrl(DOCUMENTS_BUCKET, document.path),
        })),
      );
    }

    if (safeUser.contractFilePath) {
      safeUser.contractFileUrl = await this.minioService.getFileUrl(
        DOCUMENTS_BUCKET,
        safeUser.contractFilePath,
      );
    }

    if (safeUser.profileImagePath) {
      safeUser.profileImageUrl = await this.minioService.getFileUrl(
        IMAGES_BUCKET,
        safeUser.profileImagePath,
      );
    }

    if (safeUser.coverImagePath) {
      safeUser.coverImageUrl = await this.minioService.getFileUrl(
        IMAGES_BUCKET,
        safeUser.coverImagePath,
      );
    }

    safeUser.contractExpired = Boolean(
      safeUser.contractEndDate && new Date(safeUser.contractEndDate).getTime() < Date.now(),
    );

    return safeUser;
  }

  private async ensureAgencyCode(user: AdminAgenceUser) {
    if (!user) return;
    if (user.activeRole !== AdminAgenceRole.AGENCE) return;
    if (user.agencyCode) return;

    try {
      user.agencyCode = await this.generateUniqueAgencyCode(user.agencyName || user.fullName || 'AG');
      await this.adminAgenceUserRepository.save(user);
    } catch {
      // ignore
    }
  }

  private calculateContractEndDate(startDate: Date, durationInMonths: number): Date {
    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + durationInMonths);
    return endDate;
  }

  private buildAgencyFolderName(agencyName: string) {
    return (
      agencyName
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'agency'
    );
  }

  private createStoredFileName(label: string, originalName: string) {
    const extension = originalName.includes('.') ? originalName.split('.').pop() : 'bin';
    const safeLabel =
      label
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'file';

    return `${Date.now()}-${safeLabel}.${extension}`;
  }

  private parseDocumentLabels(rawLabels: string | undefined, count: number) {
    try {
      const parsed = rawLabels ? JSON.parse(rawLabels) : [];
      if (Array.isArray(parsed)) {
        return parsed.map((label) => `${label || 'document'}`);
      }
    } catch (error) {
      return Array.from({ length: count }, (_, index) => `document-${index + 1}`);
    }

    return Array.from({ length: count }, (_, index) => `document-${index + 1}`);
  }

  private normalizeAgencyCodePrefix(input: string) {
    const letters = String(input || '')
      .toUpperCase()
      .replace(/[^A-Z]/g, '');
    return (letters.length >= 2 ? letters.slice(0, 2) : (letters + 'AG').slice(0, 2)) || 'AG';
  }

  private async generateUniqueAgencyCode(name: string) {
    const prefix = this.normalizeAgencyCodePrefix(name);
    for (let i = 0; i < 20; i++) {
      const digits = String(Math.floor(Math.random() * 100000)).padStart(5, '0');
      const code = `${prefix}${digits}`;
      const exists = await this.adminAgenceUserRepository.findOne({ where: { agencyCode: code } });
      if (!exists) return code;
    }
    throw new ConflictException('Unable to generate unique agency code');
  }

  private sanitizeUser(user: AdminAgenceUser) {
    const { password, ...safeUser } = user as AdminAgenceUser & { password?: string };
    return safeUser;
  }
}
