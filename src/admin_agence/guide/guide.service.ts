import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdminAgenceRole, AdminAgenceStatus, AdminAgenceUser } from '../auth/entities/admin-agence-user.entity';
import { Guide as FreelanceGuide, GuideRole, GuideStatus, FreelanceDocumentsVerificationStatus } from '../../sabeel-guide/auth/entities/guide.entity';
import { SaveAgencyGuideDto } from './dto/save-guide.dto';
import { AgencyGuide, AgencyGuideStatus } from './entities/guide.entity';
import { MinioService } from '../../minio/minio.service';
import * as bcrypt from 'bcryptjs';


@Injectable()
export class AgencyGuideService {
  constructor(
    @InjectRepository(AgencyGuide)
    private readonly guideRepository: Repository<AgencyGuide>,
    @InjectRepository(AdminAgenceUser)
    private readonly adminAgenceUserRepository: Repository<AdminAgenceUser>,
    @InjectRepository(FreelanceGuide)
    private readonly freelanceGuideRepository: Repository<FreelanceGuide>,
    private readonly minioService: MinioService,
  ) {}

  async listAllGuides(
    currentUser: { userId: string; activeRole: string },
    type: 'all' | 'agency' | 'freelance' = 'all',
  ) {
    if (![AdminAgenceRole.ADMIN, AdminAgenceRole.SUB_ADMIN].includes(currentUser.activeRole as AdminAgenceRole)) {
      throw new ForbiddenException('Only admins can view guides');
    }

    const shouldIncludeAgency = type === 'all' || type === 'agency';
    const shouldIncludeFreelance = type === 'all' || type === 'freelance';

    const [agencyGuides, freelanceGuides] = await Promise.all([
      shouldIncludeAgency
        ? this.guideRepository.find({ order: { createdAt: 'DESC' } })
        : Promise.resolve([] as AgencyGuide[]),
      shouldIncludeFreelance
        ? this.freelanceGuideRepository.find({ order: { createdAt: 'DESC' } })
        : Promise.resolve([] as FreelanceGuide[]),
    ]);

    const agencyIds = Array.from(new Set(agencyGuides.map((g) => g.agencyId).filter(Boolean)));
    const agencies = agencyIds.length
      ? await this.adminAgenceUserRepository.find({ where: agencyIds.map((id) => ({ id })) })
      : [];
    const agencyNameById = new Map(agencies.map((a) => [a.id, a.agencyName || a.fullName]));

    const mappedAgencyGuides = await Promise.all(
      agencyGuides.map(async (g) => ({
        id: g.id,
        name: `${g.firstName || ''} ${g.lastName || ''}`.trim(),
        type: 'agency',
        agencyId: g.agencyId,
        agencyName: agencyNameById.get(g.agencyId) || '-',
        photo: g.photo ? await this.minioService.getFileUrl('images', g.photo).catch(() => g.photo) : null,
        email: g.email,
        phone: g.phone,
        experience: g.experience,
        languages: g.languages || [],
        status: g.status,
        createdAt: g.createdAt,
        updatedAt: g.updatedAt,
      })),
    );
  
    const mappedFreelanceGuides = await Promise.all(
      freelanceGuides
        .filter((g) => (g.activeRole || g.primaryRole) === GuideRole.FREELANCE)
        .map(async (g) => ({
          id: g.id,
          name: `${g.firstName || ''} ${g.lastName || ''}`.trim(),
          type: 'freelance',
          agencyId: null,
          agencyName: '-',
          photo: g.photo ? await this.minioService.getFileUrl('images', g.photo).catch(() => g.photo) : null,
          email: g.email,
          phone: g.phoneNumber,
          experience: `${g.experience ?? ''}`,
          languages: g.languages || [],
          status: g.status,
          freelanceDocuments: await Promise.all((g.freelanceDocuments || []).map(async (key) => ({
            key,
            url: await this.minioService.getFileUrl('documents', key).catch(() => key)
          }))),
          verificationStatus: g.freelanceDocumentsVerificationStatus,
          verificationRejectReason: g.freelanceDocumentsRejectReason,
          verificationReviewedAt: g.freelanceDocumentsReviewedAt,
          createdAt: g.createdAt,
          updatedAt: g.updatedAt,
        })),
    );
  
    return {
      guides: [...mappedAgencyGuides, ...mappedFreelanceGuides].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    };
  }

  async getMyGuides(currentUser: { userId: string; activeRole: string }) {
    if (currentUser.activeRole !== AdminAgenceRole.AGENCE) {
      throw new ForbiddenException('Only agencies can view their guides');
    }

    const agency = await this.adminAgenceUserRepository.findOne({ where: { id: currentUser.userId } });
    if (!agency) {
      throw new NotFoundException('Agency not found');
    }

    this.assertAgencyCanUsePlatform(agency);

    const guides = await this.guideRepository.find({
      where: { agencyId: agency.id },
      order: { createdAt: 'DESC' },
    });

    return { guides: await Promise.all(guides.map((g) => this.mapGuide(g))) };
  }

  async create(currentUser: { userId: string; activeRole: string }, dto: SaveAgencyGuideDto) {
    if (currentUser.activeRole !== AdminAgenceRole.AGENCE) {
      throw new ForbiddenException('Only agencies can create guides');
    }

    const agency = await this.adminAgenceUserRepository.findOne({ where: { id: currentUser.userId } });
    if (!agency) {
      throw new NotFoundException('Agency not found');
    }

    this.assertAgencyCanUsePlatform(agency);

    const { password, ...agencyGuideDto } = dto as any;
    const normalizedEmail = agencyGuideDto.email?.trim().toLowerCase();

    const guide = this.guideRepository.create({
      ...agencyGuideDto,
      email: normalizedEmail,
      agencyId: agency.id,
      status: AgencyGuideStatus.ACTIVE,
    } as Partial<AgencyGuide>);

    const saved = await this.guideRepository.save(guide);
    const guideUserId = await this.upsertGuideAccountForAgencyGuide(agency.id, {
      ...dto,
      email: normalizedEmail,
    });
    if (guideUserId) {
      saved.guideUserId = guideUserId;
      await this.guideRepository.save(saved);
    }
    return { guide: this.mapGuide(saved) };
  }

  async update(
    currentUser: { userId: string; activeRole: string },
    guideId: string,
    dto: SaveAgencyGuideDto,
  ) {
    if (currentUser.activeRole !== AdminAgenceRole.AGENCE) {
      throw new ForbiddenException('Only agencies can update guides');
    }

    const guide = await this.guideRepository.findOne({ where: { id: guideId } });
    if (!guide) {
      throw new NotFoundException('Guide not found');
    }

    if (guide.agencyId !== currentUser.userId) {
      throw new ForbiddenException('You cannot update this guide');
    }

    const agency = await this.adminAgenceUserRepository.findOne({ where: { id: currentUser.userId } });
    if (!agency) {
      throw new NotFoundException('Agency not found');
    }

    this.assertAgencyCanUsePlatform(agency);

    const { password, ...agencyGuideDto } = dto as any;
    const normalizedEmail = agencyGuideDto.email?.trim().toLowerCase();

    Object.assign(guide, {
      ...agencyGuideDto,
      email: normalizedEmail,
      status: dto.status ?? guide.status,
    });

    const saved = await this.guideRepository.save(guide);
    const guideUserId = await this.upsertGuideAccountForAgencyGuide(agency.id, {
      ...dto,
      email: normalizedEmail,
    });
    if (guideUserId) {
      saved.guideUserId = guideUserId;
      await this.guideRepository.save(saved);
    }
    return { guide: this.mapGuide(saved) };
  }

  async remove(currentUser: { userId: string; activeRole: string }, guideId: string) {
    if (currentUser.activeRole !== AdminAgenceRole.AGENCE) {
      throw new ForbiddenException('Only agencies can delete guides');
    }

    const guide = await this.guideRepository.findOne({ where: { id: guideId } });
    if (!guide) {
      throw new NotFoundException('Guide not found');
    }

    if (guide.agencyId !== currentUser.userId) {
      throw new ForbiddenException('You cannot delete this guide');
    }

    const agency = await this.adminAgenceUserRepository.findOne({ where: { id: currentUser.userId } });
    if (!agency) {
      throw new NotFoundException('Agency not found');
    }

    this.assertAgencyCanUsePlatform(agency);

    await this.guideRepository.delete(guideId);
    return { message: 'Guide deleted successfully' };
  }

  async approveFreelanceDocuments(currentUser: { userId: string; activeRole: string }, guideId: string) {
    if (![AdminAgenceRole.ADMIN, AdminAgenceRole.SUB_ADMIN].includes(currentUser.activeRole as AdminAgenceRole)) {
      throw new ForbiddenException('Only admins can verify documents');
    }

    const guide = await this.freelanceGuideRepository.findOne({ where: { id: guideId } });
    if (!guide) {
      throw new NotFoundException('Freelance guide not found');
    }

    guide.freelanceDocumentsVerificationStatus = FreelanceDocumentsVerificationStatus.APPROVED;
    guide.freelanceDocumentsReviewedAt = new Date();
    guide.freelanceDocumentsRejectReason = null;
    
    // If e-mail is also verified and contract signed, we could set account status to active if needed
    // But compliance logic usually handles the 'Verified' badge display based on these flags

    await this.freelanceGuideRepository.save(guide);
    return { message: 'Documents approved successfully' };
  }

  async rejectFreelanceDocuments(
    currentUser: { userId: string; activeRole: string },
    guideId: string,
    reason: string,
  ) {
    if (![AdminAgenceRole.ADMIN, AdminAgenceRole.SUB_ADMIN].includes(currentUser.activeRole as AdminAgenceRole)) {
      throw new ForbiddenException('Only admins can reject documents');
    }

    const guide = await this.freelanceGuideRepository.findOne({ where: { id: guideId } });
    if (!guide) {
      throw new NotFoundException('Freelance guide not found');
    }

    guide.freelanceDocumentsVerificationStatus = FreelanceDocumentsVerificationStatus.REJECTED;
    guide.freelanceDocumentsReviewedAt = new Date();
    guide.freelanceDocumentsRejectReason = reason;

    await this.freelanceGuideRepository.save(guide);
    return { message: 'Documents rejected' };
  }

  private async mapGuide(guide: AgencyGuide) {
    return {
      id: guide.id,
      guideUserId: guide.guideUserId,
      firstName: guide.firstName,
      lastName: guide.lastName,
      email: guide.email,
      phone: guide.phone,
      cinPassport: guide.cinPassport,
      languages: guide.languages || [],
      experience: guide.experience,
      photo: guide.photo ? await this.minioService.getFileUrl('images', guide.photo).catch(() => guide.photo) : null,
      status: guide.status,
      createdAt: guide.createdAt,
      updatedAt: guide.updatedAt,
    };
  }

  private assertAgencyCanUsePlatform(agency: AdminAgenceUser) {
    if (!agency.profileCompletionSubmitted) {
      throw new ForbiddenException('Complete your profile and submit your dossier before using this module');
    }

    if (agency.status !== AdminAgenceStatus.ACTIVE) {
      throw new ForbiddenException('Your dossier must be validated by admin before using this module');
    }
  }

  private async linkExistingGuideAccountToAgency(agencyId: string, email?: string) {
    if (!email) return;

    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) return;

    const existingGuide = await this.freelanceGuideRepository.findOne({
      where: { email: normalizedEmail },
    });

    if (!existingGuide) return;

    existingGuide.agencyId = agencyId;
    if (existingGuide.primaryRole === GuideRole.AGENCY) {
      existingGuide.primaryRole = GuideRole.FREELANCE;
    }
    if (existingGuide.secondaryRole !== GuideRole.AGENCY) {
      existingGuide.secondaryRole = GuideRole.AGENCY;
    }

    await this.freelanceGuideRepository.save(existingGuide);
  }

  private async upsertGuideAccountForAgencyGuide(agencyId: string, dto: SaveAgencyGuideDto) {
    const email = dto.email?.trim().toLowerCase();
    if (!email) return;

    let guideAccount = await this.freelanceGuideRepository.findOne({ where: { email } });

    if (!guideAccount) {
      if (!dto.password) return;

      const hashedPassword = await bcrypt.hash(dto.password, 10);
      guideAccount = this.freelanceGuideRepository.create({
        email,
        password: hashedPassword,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phoneNumber: dto.phone,
        primaryRole: GuideRole.FREELANCE,
        secondaryRole: GuideRole.AGENCY,
        activeRole: GuideRole.AGENCY,
        agencyId,
        status: GuideStatus.ACTIVE,
        isEmailVerified: true,
        hasAcceptedTerms: true,
        hasAcceptedPrivacyPolicy: true,
        isVisible: true,
      } as Partial<FreelanceGuide>);

      await this.freelanceGuideRepository.save(guideAccount);
      return guideAccount.id;
    }

    guideAccount.agencyId = agencyId;
    if (guideAccount.primaryRole === GuideRole.AGENCY) {
      guideAccount.primaryRole = GuideRole.FREELANCE;
    }
    if (guideAccount.secondaryRole !== GuideRole.AGENCY) {
      guideAccount.secondaryRole = GuideRole.AGENCY;
    }
    guideAccount.activeRole = GuideRole.AGENCY;

    if (dto.password) {
      guideAccount.password = await bcrypt.hash(dto.password, 10);
    }

    if (dto.firstName) guideAccount.firstName = dto.firstName;
    if (dto.lastName) guideAccount.lastName = dto.lastName;
    if (dto.phone) guideAccount.phoneNumber = dto.phone;

    await this.freelanceGuideRepository.save(guideAccount);
    return guideAccount.id;
  }
}
