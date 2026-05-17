import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgencyGroup } from '../admin_agence/group/entities/group.entity';
import { AgencyGuide } from '../admin_agence/guide/entities/guide.entity';
import { MessagingGateway } from '../messaging/messaging.gateway';
import { User, UserRole } from '../sabeel/auth/entities/user.entity';
import { PilgrimLastPosition } from './entities/pilgrim-last-position.entity';
import { UpsertPositionDto } from './dto/upsert-position.dto';

@Injectable()
export class TrackingService {
  constructor(
    @InjectRepository(PilgrimLastPosition)
    private readonly lastPositionRepository: Repository<PilgrimLastPosition>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(AgencyGroup)
    private readonly groupRepository: Repository<AgencyGroup>,
    @InjectRepository(AgencyGuide)
    private readonly agencyGuideRepository: Repository<AgencyGuide>,
    private readonly messagingGateway: MessagingGateway,
  ) {}

  private assertPilgrimRole(activeRole?: string) {
    if (activeRole !== UserRole.PELEGRIN) {
      throw new ForbiddenException('Only pilgrims can share their position');
    }

  }

  private assertAccompagnantRole(activeRole?: string) {
    if (activeRole !== UserRole.ACCOMPAGNANT) {
      throw new ForbiddenException('Only accompagnant can access this resource');
    }
  }

  private assertGuideRole(activeRole?: string) {
    const allowed = activeRole === 'freelance' || activeRole === 'agency' || activeRole === 'guide';
    if (!allowed) {
      throw new ForbiddenException('Only guides can access this resource');
    }
  }

  async upsertMyPosition(currentUser: { userId: string; activeRole?: string }, dto: UpsertPositionDto) {
    this.assertPilgrimRole(currentUser?.activeRole);

    console.log('[Tracking] upsertMyPosition called', {
      userId: currentUser?.userId,
      activeRole: currentUser?.activeRole,
      latitude: dto?.latitude,
      longitude: dto?.longitude,
    });

    const pilgrim = await this.userRepository.findOne({ where: { id: currentUser.userId } });
    if (!pilgrim) {
      throw new ForbiddenException('Invalid user');
    }

    const next = this.lastPositionRepository.create({
      pilgrimUserId: pilgrim.id,
      latitude: dto.latitude,
      longitude: dto.longitude,
      accuracy: dto.accuracy ?? null,
      speed: dto.speed ?? null,
      heading: dto.heading ?? null,
      deviceTimestamp: dto.deviceTimestamp ? new Date(dto.deviceTimestamp) : null,
    });

    await this.lastPositionRepository.upsert(next, {
      conflictPaths: ['pilgrimUserId'],
    });

    const saved = await this.lastPositionRepository.findOne({ where: { pilgrimUserId: pilgrim.id } });

    const groupId = pilgrim.groupId;
    if (!groupId) {
      return { position: saved };
    }

    const group = await this.groupRepository.findOne({ where: { id: groupId } });
    if (!group?.guideId) {
      return { position: saved };
    }

    const agencyGuide = await this.agencyGuideRepository.findOne({ where: { id: group.guideId } });
    const guideUserId = agencyGuide?.guideUserId;

    if (guideUserId) {
      this.messagingGateway.emitPilgrimPositionUpdated(String(guideUserId), {
        pilgrimUserId: pilgrim.id,
        groupId,
        latitude: saved?.latitude,
        longitude: saved?.longitude,
        accuracy: saved?.accuracy,
        speed: saved?.speed,
        heading: saved?.heading,
        updatedAt: saved?.updatedAt,
      });
    }

    return { position: saved };
  }

  async stopSharingMyPosition(currentUser: { userId: string; activeRole?: string }) {
    this.assertPilgrimRole(currentUser?.activeRole);

    const pilgrim = await this.userRepository.findOne({ where: { id: currentUser.userId } });
    if (!pilgrim) {
      throw new ForbiddenException('Invalid user');
    }

    const groupId = pilgrim.groupId;
    if (!groupId) {
      return { ok: true };
    }

    const group = await this.groupRepository.findOne({ where: { id: groupId } });
    if (!group?.guideId) {
      return { ok: true };
    }

    const agencyGuide = await this.agencyGuideRepository.findOne({ where: { id: group.guideId } });
    const guideUserId = agencyGuide?.guideUserId;

    if (guideUserId) {
      this.messagingGateway.emitPilgrimPositionUpdated(String(guideUserId), {
        pilgrimUserId: pilgrim.id,
        groupId,
        latitude: null,
        longitude: null,
        updatedAt: new Date().toISOString(),
      });
    }

    return { ok: true };
  }

  async getMyPilgrimsLastPositions(currentUser: { userId: string; activeRole?: string }) {
    this.assertGuideRole(currentUser?.activeRole);

    const groups = await this.groupRepository
      .createQueryBuilder('g')
      .leftJoinAndSelect('g.guide', 'guide')
      .where('guide.guideUserId = :guideUserId', { guideUserId: currentUser.userId })
      .getMany();

    const groupIds = groups.map((g) => g.id);
    if (groupIds.length === 0) {
      return { pilgrims: [] };
    }

    const pilgrims = await this.userRepository
      .createQueryBuilder('p')
      .leftJoin(PilgrimLastPosition, 'pos', 'pos.pilgrimUserId = p.id')
      .where('p.groupId IN (:...groupIds)', { groupIds })
      .andWhere('p.activeRole = :role', { role: UserRole.PELEGRIN })
      .select([
        'p.id as id',
        'p.firstName as firstName',
        'p.lastName as lastName',
        'p.photo as photo',
        'p.shareLocation as shareLocation',
        'p.groupId as groupId',
        'p.uniqueIdentifier as uniqueIdentifier',
        'pos.latitude as latitude',
        'pos.longitude as longitude',
        'pos.accuracy as accuracy',
        'pos.speed as speed',
        'pos.heading as heading',
        'pos.updatedAt as updatedAt',
      ])
      .getRawMany();

    return { pilgrims };
  }

  async getPilgrimLastPositionForAccompagnant(
    currentUser: { userId: string; activeRole?: string },
    pilgrimUserId: string,
  ) {
    this.assertAccompagnantRole(currentUser?.activeRole);
    if (!pilgrimUserId) {
      throw new ForbiddenException('Invalid pilgrim');
    }

    const me = await this.userRepository.findOne({ where: { id: currentUser.userId } });
    if (!me) {
      throw new ForbiddenException('Invalid user');
    }

    if (!me.accompaniedPilgrimId || String(me.accompaniedPilgrimId) !== String(pilgrimUserId)) {
      throw new ForbiddenException('You are not linked to this pilgrim');
    }

    const pilgrim = await this.userRepository.findOne({ where: { id: pilgrimUserId } });
    if (!pilgrim) {
      throw new ForbiddenException('Invalid pilgrim');
    }

    if (!pilgrim.shareLocation) {
      throw new ForbiddenException('Pilgrim location sharing is disabled');
    }

    const position = await this.lastPositionRepository.findOne({ where: { pilgrimUserId } });

    return {
      pilgrim: {
        id: pilgrim.id,
        firstName: pilgrim.firstName,
        lastName: pilgrim.lastName,
        photo: pilgrim.photo,
        uniqueIdentifier: pilgrim.uniqueIdentifier,
        shareLocation: pilgrim.shareLocation,
        groupId: pilgrim.groupId,
      },
      position,
    };
  }
}
