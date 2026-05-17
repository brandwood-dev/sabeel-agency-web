import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { MinioService } from '../../minio/minio.service';
import { User, UserRole } from '../../sabeel/auth/entities/user.entity';
import { Reservation, ReservationKind, ReservationStatus } from '../../sabeel/reservation/entities/reservation.entity';
import { CreateFreelanceGroupDto } from './dto/create-freelance-group.dto';
import { UpdateFreelanceGroupDto } from './dto/update-freelance-group.dto';
import { FreelanceGroup } from './entities/freelance-group.entity';
import { FreelanceGroupMember } from './entities/freelance-group-member.entity';

@Injectable()
export class FreelanceGroupsService {
  constructor(
    @InjectRepository(FreelanceGroup)
    private readonly freelanceGroupRepository: Repository<FreelanceGroup>,
    @InjectRepository(FreelanceGroupMember)
    private readonly freelanceGroupMemberRepository: Repository<FreelanceGroupMember>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Reservation)
    private readonly reservationRepository: Repository<Reservation>,
    private readonly minioService: MinioService,
  ) {}

  private assertFreelance(activeRole?: string) {
    if (activeRole !== 'freelance') {
      throw new ForbiddenException('Only freelance guides can manage freelance groups');
    }
  }

  private async mapGroup(group: FreelanceGroup) {
    const imageUrl = group.imageUrl
      ? await this.minioService.getFileUrl('images', group.imageUrl).catch(() => group.imageUrl)
      : null;

    return {
      ...group,
      imageUrl,
    };
  }

  async create(currentUser: { userId: string; activeRole?: string }, dto: CreateFreelanceGroupDto) {
    this.assertFreelance(currentUser.activeRole);

    const group = this.freelanceGroupRepository.create({
      guideUserId: currentUser.userId,
      name: String(dto?.name || '').trim(),
      period: dto?.period ? String(dto.period) : null,
      city: dto?.city ? String(dto.city) : null,
      maxPilgrims:
        dto?.maxPilgrims !== undefined && dto?.maxPilgrims !== null ? Number(dto.maxPilgrims) : null,
      imageUrl: dto?.imageUrl ? String(dto.imageUrl) : null,
    });

    const saved = await this.freelanceGroupRepository.save(group);
    return { group: await this.mapGroup(saved) };
  }

  async getMine(currentUser: { userId: string; activeRole?: string }) {
    this.assertFreelance(currentUser.activeRole);

    const groups = await this.freelanceGroupRepository.find({
      where: { guideUserId: currentUser.userId },
      order: { createdAt: 'DESC' },
    });

    return { groups: await Promise.all(groups.map((g) => this.mapGroup(g))) };
  }

  async getById(currentUser: { userId: string; activeRole?: string }, groupId: string) {
    this.assertFreelance(currentUser.activeRole);

    const group = await this.freelanceGroupRepository.findOne({
      where: { id: groupId, guideUserId: currentUser.userId },
    });

    if (!group) {
      throw new NotFoundException('Group not found');
    }

    const members = await this.getMembers(currentUser, groupId);
    return { group: { ...(await this.mapGroup(group)), pilgrims: members.pilgrims } };
  }

  async getMembers(currentUser: { userId: string; activeRole?: string }, groupId: string) {
    this.assertFreelance(currentUser.activeRole);

    await this.getByIdWithoutMembers(currentUser, groupId);

    const rows = await this.freelanceGroupMemberRepository.find({ where: { groupId } });
    const pilgrimIds = rows.map((r) => String(r.pilgrimUserId));
    if (!pilgrimIds.length) return { pilgrims: [] };

    const pilgrims = await this.userRepository.find({
      where: { id: In(pilgrimIds), activeRole: UserRole.PELEGRIN },
      select: ['id', 'firstName', 'lastName', 'email', 'phoneNumber', 'photo'],
    });

    const byId = new Map(pilgrims.map((p) => [String(p.id), p]));
    return { pilgrims: pilgrimIds.map((id) => byId.get(String(id))).filter(Boolean) };
  }

  async getAvailableAcceptedPilgrims(
    currentUser: { userId: string; activeRole?: string },
    groupId: string,
  ) {
    this.assertFreelance(currentUser.activeRole);

    await this.getByIdWithoutMembers(currentUser, groupId);

    const myGroups = await this.freelanceGroupRepository.find({
      where: { guideUserId: currentUser.userId },
      select: ['id'],
    });
    const myGroupIds = myGroups.map((g) => String(g.id)).filter(Boolean);

    const alreadyAssignedRows = myGroupIds.length
      ? await this.freelanceGroupMemberRepository.find({ where: { groupId: In(myGroupIds) } as any })
      : [];
    const alreadyAssignedIds = new Set(alreadyAssignedRows.map((r) => String(r.pilgrimUserId)));

    const acceptedReservations = await this.reservationRepository.find({
      where: {
        kind: ReservationKind.GUIDE,
        guideId: currentUser.userId,
        status: ReservationStatus.ACCEPTED,
      },
      select: ['pilgrimUserId'],
    });

    const acceptedPilgrimIds = Array.from(
      new Set(
        acceptedReservations
          .map((r) => String(r.pilgrimUserId))
          .filter((id) => id && !alreadyAssignedIds.has(id)),
      ),
    );

    if (!acceptedPilgrimIds.length) return { pilgrims: [] };

    const pilgrims = await this.userRepository.find({
      where: { id: In(acceptedPilgrimIds), activeRole: UserRole.PELEGRIN },
      select: ['id', 'firstName', 'lastName', 'email', 'phoneNumber', 'photo'],
    });

    return { pilgrims };
  }

  async assignPilgrims(
    currentUser: { userId: string; activeRole?: string },
    groupId: string,
    pilgrimIds: string[],
  ) {
    this.assertFreelance(currentUser.activeRole);

    const group = await this.getByIdWithoutMembers(currentUser, groupId);
    const max = group.maxPilgrims ? Number(group.maxPilgrims) : 0;
    if (max > 0) {
      const existingCount = await this.freelanceGroupMemberRepository.count({ where: { groupId } });
      const toAddCount = Array.isArray(pilgrimIds) ? pilgrimIds.length : 0;
      if (existingCount + toAddCount > max) {
        throw new BadRequestException(`Capacité dépassée. Capacité max: ${max}, déjà assignés: ${existingCount}`);
      }
    }

    const normalizedIds = Array.from(new Set((pilgrimIds || []).map((id) => String(id)).filter(Boolean)));
    if (!normalizedIds.length) {
      return this.getById(currentUser, groupId);
    }

    const acceptedForThose = await this.reservationRepository.find({
      where: {
        kind: ReservationKind.GUIDE,
        guideId: currentUser.userId,
        status: ReservationStatus.ACCEPTED,
        pilgrimUserId: In(normalizedIds),
      },
      select: ['pilgrimUserId'],
    });

    const acceptedSet = new Set(acceptedForThose.map((r) => String(r.pilgrimUserId)));
    const notAccepted = normalizedIds.filter((id) => !acceptedSet.has(String(id)));
    if (notAccepted.length) {
      throw new ForbiddenException('Only accepted pilgrims can be added to this group');
    }

    const myGroups = await this.freelanceGroupRepository.find({
      where: { guideUserId: currentUser.userId },
      select: ['id'],
    });
    const myGroupIds = myGroups.map((g) => String(g.id)).filter(Boolean);

    // Block: a pilgrim cannot be member of two different freelance groups for this guide
    const existingMemberships = myGroupIds.length
      ? await this.freelanceGroupMemberRepository.find({
          where: { groupId: In(myGroupIds), pilgrimUserId: In(normalizedIds) } as any,
        })
      : [];
    const alreadyInAnotherGroup = existingMemberships.filter((m) => String(m.groupId) !== String(groupId));
    if (alreadyInAnotherGroup.length) {
      throw new BadRequestException('Un pèlerin ne peut pas être assigné à deux groupes');
    }

    const existingRows = await this.freelanceGroupMemberRepository.find({ where: { groupId, pilgrimUserId: In(normalizedIds) } as any });
    const existingSet = new Set(existingRows.map((r) => String(r.pilgrimUserId)));
    const rowsToCreate = normalizedIds
      .filter((id) => !existingSet.has(String(id)))
      .map((id) => this.freelanceGroupMemberRepository.create({ groupId, pilgrimUserId: id }));

    if (rowsToCreate.length) {
      await this.freelanceGroupMemberRepository.save(rowsToCreate);
    }

    return this.getById(currentUser, groupId);
  }

  async removePilgrim(currentUser: { userId: string; activeRole?: string }, groupId: string, pilgrimId: string) {
    this.assertFreelance(currentUser.activeRole);
    await this.getByIdWithoutMembers(currentUser, groupId);

    await this.freelanceGroupMemberRepository.delete({ groupId, pilgrimUserId: String(pilgrimId) } as any);
    return this.getById(currentUser, groupId);
  }

  private async getByIdWithoutMembers(currentUser: { userId: string; activeRole?: string }, groupId: string) {
    this.assertFreelance(currentUser.activeRole);
    const group = await this.freelanceGroupRepository.findOne({ where: { id: groupId, guideUserId: currentUser.userId } });
    if (!group) throw new NotFoundException('Group not found');
    return group;
  }

  async update(currentUser: { userId: string; activeRole?: string }, groupId: string, dto: UpdateFreelanceGroupDto) {
    this.assertFreelance(currentUser.activeRole);

    const group = await this.freelanceGroupRepository.findOne({
      where: { id: groupId, guideUserId: currentUser.userId },
    });

    if (!group) {
      throw new NotFoundException('Group not found');
    }

    if (dto?.name !== undefined) group.name = String(dto.name || '').trim();
    if (dto?.period !== undefined) group.period = dto.period ? String(dto.period) : null;
    if (dto?.city !== undefined) group.city = dto.city ? String(dto.city) : null;
    if (dto?.maxPilgrims !== undefined) {
      group.maxPilgrims = dto.maxPilgrims !== null && dto.maxPilgrims !== undefined ? Number(dto.maxPilgrims) : null;
    }
    if (dto?.imageUrl !== undefined) group.imageUrl = dto.imageUrl ? String(dto.imageUrl) : null;

    const saved = await this.freelanceGroupRepository.save(group);
    return { group: await this.mapGroup(saved) };
  }

  async delete(currentUser: { userId: string; activeRole?: string }, groupId: string) {
    this.assertFreelance(currentUser.activeRole);

    const group = await this.freelanceGroupRepository.findOne({
      where: { id: groupId, guideUserId: currentUser.userId },
    });

    if (!group) {
      throw new NotFoundException('Group not found');
    }

    await this.freelanceGroupRepository.remove(group);
    return { success: true };
  }
}
