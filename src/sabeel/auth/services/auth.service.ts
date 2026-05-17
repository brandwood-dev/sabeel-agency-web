import { Injectable, UnauthorizedException, BadRequestException, NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { AgencyGroup } from '../../../admin_agence/group/entities/group.entity';
import { AgencyGuide } from '../../../admin_agence/guide/entities/guide.entity';
import { AdminAgenceUser } from '../../../admin_agence/auth/entities/admin-agence-user.entity';
import { Reservation, ReservationStatus } from '../../reservation/entities/reservation.entity';
import { User, UserStatus, UserRole } from '../entities/user.entity';
import { PackUmrah } from '../../../admin_agence/pack_umrah/entities/pack-umrah.entity';
import { SignupStep1Dto } from '../dto/signup-step1.dto';
import { SignupStep2Dto } from '../dto/signup-step2.dto';
import { SignupStep3Dto } from '../dto/signup-step3.dto';
import { LoginDto } from '../dto/login.dto';
import { SwitchRoleDto } from '../dto/switch-role.dto';
import { ForgotPasswordDto } from '../dto/forgot-password.dto';
import { VerifyOtpDto } from '../dto/verify-otp.dto';
import { ChangePasswordDto } from '../dto/change-password.dto';
import { SessionStorageService, SignupSessionData } from './session-storage.service';
import { EmailService } from './email.service';
import { MinioService } from '../../../minio/minio.service';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(AgencyGroup)
    private groupRepository: Repository<AgencyGroup>,
    @InjectRepository(AgencyGuide)
    private agencyGuideRepository: Repository<AgencyGuide>,
    @InjectRepository(AdminAgenceUser)
    private agencyRepository: Repository<AdminAgenceUser>,
    @InjectRepository(Reservation)
    private reservationRepository: Repository<Reservation>,
    @InjectRepository(PackUmrah)
    private packRepository: Repository<PackUmrah>,
    private jwtService: JwtService,
    private sessionStorageService: SessionStorageService,
    private emailService: EmailService,
    private minioService: MinioService,
  ) {}

  private normalizeIdentifier(identifier: string) {
    return String(identifier || '').trim();
  }

  private async resolvePilgrimContext(pilgrimUserId: string) {
    const pilgrim = await this.userRepository.findOne({ where: { id: pilgrimUserId } });
    if (!pilgrim) {
      throw new NotFoundException('Pèlerin introuvable');
    }

    if (pilgrim.photo && !pilgrim.photo.startsWith('http')) {
      pilgrim.photo = await this.minioService.getFileUrl('images', pilgrim.photo).catch(() => pilgrim.photo);
    }

    const groupId = pilgrim.groupId;
    if (!groupId) {
      return {
        pilgrim,
        group: null,
        agency: null,
        guide: null,
      };
    }

    const group = groupId ? await this.groupRepository.findOne({ where: { id: groupId } }) : null;
    let agency = group?.agencyId
      ? await this.agencyRepository.findOne({ where: { id: group.agencyId } })
      : null;

    let guide = group?.guideId
      ? await this.agencyGuideRepository.findOne({ where: { id: group.guideId } })
      : null;

    // 2. Try direct links on user entity
    if (!agency && pilgrim.agencyId) {
      agency = await this.agencyRepository.findOne({ where: { id: pilgrim.agencyId } });
    }
    if (!guide && pilgrim.guideId) {
      guide = await this.agencyGuideRepository.findOne({ where: { id: pilgrim.guideId } });
    }

    // 3. If still no agency or guide, look for the latest accepted reservation
    if (!agency || !guide) {
      const activeReservation = await this.reservationRepository.findOne({
        where: { pilgrimUserId, status: ReservationStatus.ACCEPTED },
        order: { updatedAt: 'DESC' },
      });

      if (activeReservation) {
        if (!agency && activeReservation.agencyId) {
          agency = await this.agencyRepository.findOne({ where: { id: activeReservation.agencyId } });
        }
        
        if (!guide) {
          if (activeReservation.guideId) {
            // Direct guide reservation
            guide = await this.agencyGuideRepository.findOne({ where: { id: activeReservation.guideId } });
          } else if (activeReservation.packId) {
            // Check if the pack has a guideId we can use
            const pack = await this.packRepository.findOne({ where: { id: activeReservation.packId } });
            if (pack?.guideId) {
              guide = await this.agencyGuideRepository.findOne({ where: { id: pack.guideId } });
            }
          }
        }
      }
    }

    if (agency && agency.profileImagePath && !agency.profileImagePath.startsWith('http')) {
      agency.profileImagePath = await this.minioService.getFileUrl('images', agency.profileImagePath).catch(() => agency.profileImagePath);
    }
    if (guide && guide.photo && !guide.photo.startsWith('http')) {
      guide.photo = await this.minioService.getFileUrl('images', guide.photo).catch(() => guide.photo);
    }

    return {
      pilgrim,
      group,
      agency,
      guide,
    };
  }

  async signupStep1(signupStep1Dto: SignupStep1Dto): Promise<{ message: string; user: Partial<User>; accessToken: string }> {
    const { email, phoneNumber, password, confirmPassword, firstName, lastName, role, hasAcceptedTerms, hasAcceptedPrivacyPolicy } = signupStep1Dto;

    if (confirmPassword && password !== confirmPassword) {
      throw new BadRequestException('Passwords do not match');
    }

    // Default to true if not provided (assuming frontend handles it but doesn't send it yet)
    const terms = hasAcceptedTerms !== undefined ? hasAcceptedTerms : true;
    const policy = hasAcceptedPrivacyPolicy !== undefined ? hasAcceptedPrivacyPolicy : true;

    if (!terms || !policy) {
      throw new BadRequestException('You must accept terms and privacy policy');
    }

    const existingUser = await this.userRepository.findOne({
      where: [{ email }, { phoneNumber }],
    });


    if (existingUser) {
      if (existingUser.email === email) {
        throw new ConflictException('Email already exists');
      }
      if (existingUser.phoneNumber === phoneNumber) {
        throw new ConflictException('Phone number already exists');
      }
    }

    const user = this.userRepository.create({
      email,
      phoneNumber,
      password, // Sera hashé automatiquement par @BeforeInsert
      firstName,
      lastName,
      primaryRole: role as UserRole || UserRole.PELEGRIN,
      activeRole: role as UserRole || UserRole.PELEGRIN,
      status: UserStatus.ACTIVE, // Actif immédiatement
      hasAcceptedTerms,
      hasAcceptedPrivacyPolicy,
    });

    const savedUser = await this.userRepository.save(user);

    // Envoyer email de bienvenue
    await this.emailService.sendWelcomeEmail(user.email, user.firstName);

    // Générer le JWT token pour connexion immédiate
    const payload = {
      sub: savedUser.id,
      email: savedUser.email,
      activeRole: savedUser.activeRole,
      uniqueIdentifier: savedUser.uniqueIdentifier,
    };

    const accessToken = this.jwtService.sign(payload);

    const { password: _, ...userWithoutPassword } = savedUser as any;

    return {
      message: 'Account created successfully',
      user: userWithoutPassword,
      accessToken,
    };
  }

  async listPilgrimsForAdmin(currentUser: { userId: string; activeRole?: string }) {
    if (currentUser.activeRole !== 'admin' && currentUser.activeRole !== 'sub_admin') {
      throw new ForbiddenException('Only admins can view pilgrims');
    }

    const pilgrims = await this.userRepository.find({
      where: [{ primaryRole: UserRole.PELEGRIN }, { activeRole: UserRole.PELEGRIN }],
      order: { createdAt: 'DESC' },
      select: ['id', 'firstName', 'lastName', 'email', 'phoneNumber', 'activeRole', 'primaryRole', 'status'],
    });

    return { pilgrims };
  }

  async completeProfileStep2(userId: string, profileStep2Dto: SignupStep2Dto): Promise<{ message: string; user: Partial<User> }> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Mettre à jour les informations du profil
    if (profileStep2Dto.dateOfBirth) {
      user.dateOfBirth = new Date(profileStep2Dto.dateOfBirth);
    }
    user.gender = profileStep2Dto.gender;
    user.nationality = profileStep2Dto.nationality;
    user.country = profileStep2Dto.country;
    user.city = profileStep2Dto.city;
    user.address = profileStep2Dto.address;

    await this.userRepository.save(user);

    const { password, ...userWithoutPassword } = user;

    return {
      message: 'Profile step 2 completed successfully',
      user: userWithoutPassword,
    };
  }

  async completeProfileStep3(userId: string, profileStep3Dto: SignupStep3Dto): Promise<{ message: string; user: Partial<User> }> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Mettre à jour les documents (optionnels)
    if (profileStep3Dto.cinOrPassport) {
      user.cinOrPassport = profileStep3Dto.cinOrPassport;
    }
    if (profileStep3Dto.photo) {
      user.photo = profileStep3Dto.photo;
    }
    if (profileStep3Dto.qrId) {
      user.qrId = profileStep3Dto.qrId;
    }

    await this.userRepository.save(user);

    const { password, ...userWithoutPassword } = user;

    return {
      message: 'Profile completed successfully',
      user: userWithoutPassword,
    };
  }

  async login(loginDto: LoginDto): Promise<{ accessToken: string; user: Partial<User> }> {
    const { email, password } = loginDto;

    const user = await this.userRepository.findOne({
      where: { email },
      select: ['id', 'email', 'password', 'firstName', 'lastName', 'activeRole', 'primaryRole', 'secondaryRole', 'status', 'uniqueIdentifier'],
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.status !== UserStatus.ACTIVE && user.status !== UserStatus.PENDING) {
      throw new UnauthorizedException('Account is not active');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    user.lastLoginAt = new Date();
    
    // Activate account if it was pending
    if (user.status === UserStatus.PENDING) {
      user.status = UserStatus.ACTIVE;
    }
    
    await this.userRepository.save(user);

    const payload = {
      sub: user.id,
      email: user.email,
      activeRole: user.activeRole,
      uniqueIdentifier: user.uniqueIdentifier,
    };

    const accessToken = this.jwtService.sign(payload);

    const { password: _, ...userWithoutPassword } = user;

    return {
      accessToken,
      user: userWithoutPassword,
    };
  }

  async forgotPassword(forgotPasswordDto: ForgotPasswordDto): Promise<{ message: string; resetToken: string }> {
    const { email } = forgotPasswordDto;

    const user = await this.userRepository.findOne({
      where: { email },
    });

    if (!user) {
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

      const user = await this.userRepository.findOne({
        where: { email },
      });

      if (!user) {
        throw new NotFoundException('User not found');
      }

      const hashedPassword = await bcrypt.hash(newPassword, 10);
      user.password = hashedPassword;
      await this.userRepository.save(user);

      return {
        message: 'Password changed successfully',
      };
    } catch (error) {
      throw new BadRequestException('Invalid or expired reset token');
    }
  }

  async updatePassword(userId: string, changePasswordDto: ChangePasswordDto): Promise<{ message: string }> {
    const { currentPassword, newPassword, confirmPassword } = changePasswordDto;

    if (!currentPassword) {
      throw new BadRequestException('Current password is required');
    }

    if (newPassword !== confirmPassword) {
      throw new BadRequestException('Passwords do not match');
    }

    if (newPassword.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters long');
    }

    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: ['id', 'password'],
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isPasswordValid) {
      throw new BadRequestException('Current password is incorrect');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    await this.userRepository.save(user);

    return {
      message: 'Password updated successfully',
    };
  }

  async logout(userId: string): Promise<{ message: string }> {
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

  async switchRole(userId: string, switchRoleDto: SwitchRoleDto): Promise<{ message: string; user: Partial<User>; accessToken: string }> {
    const { targetRole } = switchRoleDto;

    const user = await this.userRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (targetRole !== user.primaryRole && targetRole !== user.secondaryRole) {
      user.secondaryRole = targetRole;
    }

    user.activeRole = targetRole;
    const savedUser = await this.userRepository.save(user);

    const payload = {
      sub: savedUser.id,
      email: savedUser.email,
      activeRole: savedUser.activeRole,
      uniqueIdentifier: savedUser.uniqueIdentifier,
    };
    const accessToken = this.jwtService.sign(payload);

    const { password, ...userWithoutPassword } = savedUser;

    return {
      message: `Successfully switched to ${targetRole} role`,
      user: userWithoutPassword,
      accessToken,
    };
  }

  async findPilgrimByIdentifier(identifier: string): Promise<Partial<User>> {
    const user = await this.userRepository.findOne({
      where: { uniqueIdentifier: identifier },
      select: ['id', 'firstName', 'lastName', 'activeRole', 'shareLocation', 'photo']
    });

    if (!user) {
      throw new NotFoundException('Pèlerin introuvable');
    }

    if (!user.shareLocation) {
      throw new ForbiddenException('Ce pèlerin n\'a pas activé le partage de sa position');
    }

    return user;
  }

  async linkPilgrimToAccompagnant(
    currentUser: { userId: string; activeRole?: string },
    identifier: string,
  ) {
    if (currentUser?.activeRole !== UserRole.PELEGRIN && currentUser?.activeRole !== UserRole.ACCOMPAGNANT) {
      throw new ForbiddenException('Unauthorized role');
    }

    const normalized = this.normalizeIdentifier(identifier);
    if (!normalized) {
      throw new BadRequestException('Identifier is required');
    }

    // Accept both raw string QR payloads and JSON like {"id": "XX123456"}
    let toLookup = normalized;
    if (normalized.startsWith('{') && normalized.endsWith('}')) {
      try {
        const parsed = JSON.parse(normalized);
        if (parsed?.id) {
          toLookup = this.normalizeIdentifier(parsed.id);
        }
      } catch {
        // ignore parsing errors, keep raw
      }
    }

    const pilgrim = await this.userRepository.findOne({
      where: [{ uniqueIdentifier: toLookup }, { qrId: toLookup }],
    } as any);

    if (!pilgrim) {
      throw new NotFoundException('Pèlerin introuvable');
    }

    if (!pilgrim.shareLocation) {
      throw new ForbiddenException("Ce pèlerin n'a pas activé le partage de sa position");
    }

    const me = await this.userRepository.findOne({ where: { id: currentUser.userId } });
    if (!me) {
      throw new UnauthorizedException('User not found');
    }

    me.accompaniedPilgrimId = pilgrim.id;
    const saved = await this.userRepository.save(me);

    const context = await this.resolvePilgrimContext(pilgrim.id);

    const { password, ...meWithoutPassword } = saved as any;

    return {
      message: 'Pilgrim linked successfully',
      user: meWithoutPassword,
      ...context,
    };
  }

  async getMyAccompaniedPilgrim(currentUser: { userId: string; activeRole?: string }) {
    if (currentUser?.activeRole !== UserRole.ACCOMPAGNANT) {
      throw new ForbiddenException('Only accompagnant can access this resource');
    }

    const me = await this.userRepository.findOne({ where: { id: currentUser.userId } });
    if (!me) {
      throw new UnauthorizedException('User not found');
    }

    if (!me.accompaniedPilgrimId) {
      return {
        pilgrim: null,
        group: null,
        agency: null,
        guide: null,
      };
    }

    return this.resolvePilgrimContext(me.accompaniedPilgrimId);
  }

  async addSecondaryRole(userId: string, secondaryRole: UserRole): Promise<{ message: string; user: Partial<User> }> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (secondaryRole === user.primaryRole) {
      throw new BadRequestException('This is already your primary role');
    }

    if (user.secondaryRole) {
      throw new BadRequestException('You already have a secondary role');
    }

    user.secondaryRole = secondaryRole;
    await this.userRepository.save(user);

    const { password, ...userWithoutPassword } = user;

    return {
      message: `Secondary role ${secondaryRole} added successfully`,
      user: userWithoutPassword,
    };
  }

  async getProfile(userId: string): Promise<Partial<User>> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: ['id', 'email', 'firstName', 'lastName', 'phoneNumber', 'activeRole', 'primaryRole', 'secondaryRole', 'status', 'lastLoginAt', 'createdAt', 'uniqueIdentifier', 'dateOfBirth', 'gender', 'nationality', 'country', 'city', 'address', 'cinOrPassport', 'photo', 'qrId', 'bio', 'languages'],

    });


    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (user.photo && !user.photo.startsWith('http')) {
      try {
        user.photo = await this.minioService.getFileUrl('images', user.photo);
        console.log(`[DEBUG] Presigned URL for profile: ${user.photo}`);

      } catch (error) {
        console.error('Failed to get photo URL from Minio:', error);
      }
    }

    return user;

  }

  async updateProfile(userId: string, updateData: any): Promise<{ message: string; user: Partial<User> }> {
    console.log(`[DEBUG] Updating profile for user ${userId}`, updateData);
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    Object.assign(user, updateData);
    console.log(`[DEBUG] User after assign:`, { id: user.id, phoneNumber: user.phoneNumber, firstName: user.firstName });
    
    const updatedUser = await this.userRepository.save(user);
    const { password: _, ...userWithoutPassword } = updatedUser;


    return {
      message: 'Profile updated successfully',
      user: userWithoutPassword,
    };
  }

  async uploadProfilePhoto(userId: string, file: any): Promise<{ message: string; photoUrl: string }> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const fileName = `${user.firstName}_${user.lastName}_${userId}_photo`.toLowerCase().replace(/\s+/g, '_');
    const extension = file.originalname.split('.').pop();
    const fullFileName = `${fileName}.${extension}`;

    // Upload to MinIO (bucket 'images' from config)
    await this.minioService.uploadFile('images', fullFileName, file.buffer, file.mimetype);

    // Get presigned URL
    const photoUrl = await this.minioService.getFileUrl('images', fullFileName);
    console.log(`[DEBUG] Generated upload URL: ${photoUrl}`);


    // Update user in DB
    user.photo = fullFileName;
    await this.userRepository.save(user);

    return {
      message: 'Photo uploaded successfully',
      photoUrl,
    };
  }


  async deleteAccount(userId: string): Promise<{ message: string }> {

    const user = await this.userRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Supprimer l'utilisateur de la base de données
    await this.userRepository.remove(user);

    // Nettoyer les sessions éventuelles
    this.sessionStorageService.deleteSession(user.email);

    return {
      message: 'Account deleted successfully',
    };
  }

  async sendSupportMessage(userId: string, body: { message: string }): Promise<{ message: string }> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: ['id', 'email', 'firstName', 'lastName'],
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const userName = `${user.firstName} ${user.lastName}`;
    await this.emailService.sendSupportEmail(user.email, userName, body.message);

    return {
      message: 'Support message sent successfully',
    };
  }
}

