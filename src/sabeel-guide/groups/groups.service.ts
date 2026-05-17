import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MinioService } from '../../minio/minio.service';
import { AgencyGroup } from '../../admin_agence/group/entities/group.entity';
import { In, IsNull } from 'typeorm';
import { User, UserRole } from '../../sabeel/auth/entities/user.entity';

@Injectable()
export class GroupsService {
  constructor(
    @InjectRepository(AgencyGroup)
    private readonly groupRepository: Repository<AgencyGroup>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly minioService: MinioService,
  ) {}

  private assertGuideRole(activeRole?: string) {
    const allowed = activeRole === 'freelance' || activeRole === 'agency' || activeRole === 'guide';
    if (!allowed) {
      throw new ForbiddenException('Only guides can access this resource');
    }
  }

  private assertFreelance(activeRole?: string) {
    if (activeRole !== 'freelance') {
      throw new ForbiddenException('Only freelance guides can manage pilgrims in groups');
    }
  }

  private async mapGroup(group: AgencyGroup) {
    const presignedImageUrl = group.imageUrl
      ? await this.minioService.getFileUrl('images', group.imageUrl).catch(() => group.imageUrl)
      : null;

    return {
      ...group,
      imageUrl: presignedImageUrl,
    };
  }

  async getMyGroups(currentUser: { userId: string; activeRole?: string }) {
    try {
      this.assertGuideRole(currentUser?.activeRole);

      const groups = await this.groupRepository
        .createQueryBuilder('g')
        .leftJoinAndSelect('g.pack', 'pack')
        .leftJoinAndSelect('g.guide', 'guide')
        .leftJoinAndSelect('g.pilgrims', 'pilgrims')
        .where('guide.guideUserId = :guideUserId', { guideUserId: currentUser.userId })
        .orderBy('g.createdAt', 'DESC')
        .getMany();

      return { groups: await Promise.all(groups.map((g) => this.mapGroup(g))) };
    } catch (error) {
      console.error('[GroupsService] getMyGroups database/mapping error:', error);
      throw new BadRequestException(`Failed to fetch groups: ${error.message}`);
    }
  }

  async getGroupById(currentUser: { userId: string; activeRole?: string }, groupId: string) {
    this.assertGuideRole(currentUser?.activeRole);

    const group = await this.groupRepository
      .createQueryBuilder('g')
      .leftJoinAndSelect('g.pack', 'pack')
      .leftJoinAndSelect('g.guide', 'guide')
      .leftJoinAndSelect('g.pilgrims', 'pilgrims')
      .where('g.id = :groupId', { groupId })
      .andWhere('guide.guideUserId = :guideUserId', { guideUserId: currentUser.userId })
      .getOne();

    if (!group) {
      throw new NotFoundException('Group not found');
    }

    return this.mapGroup(group);
  }

  async getAvailablePilgrimsForGroup(currentUser: { userId: string; activeRole?: string }, groupId: string) {
    this.assertGuideRole(currentUser?.activeRole);

    // Ensure guide is assigned to this group
    await this.getGroupById(currentUser, groupId);

    const pilgrims = await this.userRepository.find({
      where: {
        activeRole: UserRole.PELEGRIN,
        groupId: IsNull(),
      },
      select: ['id', 'firstName', 'lastName', 'email', 'phoneNumber', 'photo'],
    });

    return { pilgrims };
  }

  async assignPilgrims(
    currentUser: { userId: string; activeRole?: string },
    groupId: string,
    pilgrimIds: string[],
  ) {
    this.assertGuideRole(currentUser?.activeRole);
    this.assertFreelance(currentUser?.activeRole);

    const group = await this.groupRepository
      .createQueryBuilder('g')
      .leftJoinAndSelect('g.guide', 'guide')
      .leftJoinAndSelect('g.pilgrims', 'pilgrims')
      .where('g.id = :groupId', { groupId })
      .andWhere('guide.guideUserId = :guideUserId', { guideUserId: currentUser.userId })
      .getOne();

    if (!group) throw new NotFoundException('Group not found');

    const currentCount = group.pilgrims?.length || 0;
    if (currentCount + (pilgrimIds?.length || 0) > group.capacity) {
      throw new BadRequestException(
        `Capacité dépassée. Capacité max: ${group.capacity}, déjà assignés: ${currentCount}`,
      );
    }

    await this.userRepository.update({ id: In(pilgrimIds) }, { groupId });
    return this.getGroupById(currentUser, groupId);
  }

  async removePilgrim(
    currentUser: { userId: string; activeRole?: string },
    groupId: string,
    pilgrimId: string,
  ) {
    this.assertGuideRole(currentUser?.activeRole);
    this.assertFreelance(currentUser?.activeRole);

    // Ensure guide is assigned to this group
    await this.getGroupById(currentUser, groupId);

    await this.userRepository.update({ id: pilgrimId, groupId }, { groupId: null });
    return this.getGroupById(currentUser, groupId);
  }
}
