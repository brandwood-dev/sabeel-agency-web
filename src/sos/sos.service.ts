import { Injectable, ForbiddenException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserRole } from '../sabeel/auth/entities/user.entity';
import { AgencyGroup } from '../admin_agence/group/entities/group.entity';
import { AgencyGuide } from '../admin_agence/guide/entities/guide.entity';
import { AdminAgenceUser } from '../admin_agence/auth/entities/admin-agence-user.entity';
import { Reservation, ReservationStatus } from '../sabeel/reservation/entities/reservation.entity';
import { PackUmrah } from '../admin_agence/pack_umrah/entities/pack-umrah.entity';
import { NotificationEventType, NotificationService } from '../common/services/notification.service';

export type SosTriggerPayload = {
  latitude: number;
  longitude: number;
  accuracy?: number;
  deviceTimestamp?: string;
};

@Injectable()
export class SosService {
  private readonly logger = new Logger(SosService.name);

  constructor(
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    @InjectRepository(AgencyGroup) private readonly groupRepository: Repository<AgencyGroup>,
    @InjectRepository(AgencyGuide) private readonly agencyGuideRepository: Repository<AgencyGuide>,
    @InjectRepository(AdminAgenceUser) private readonly agencyRepository: Repository<AdminAgenceUser>,
    @InjectRepository(Reservation) private readonly reservationRepository: Repository<Reservation>,
    @InjectRepository(PackUmrah) private readonly packRepository: Repository<PackUmrah>,
    private readonly notificationService: NotificationService,
  ) {}

  private async resolvePilgrimContext(pilgrimUserId: string) {
    const pilgrim = await this.userRepository.findOne({ where: { id: pilgrimUserId } });
    if (!pilgrim) throw new ForbiddenException('Invalid pilgrim');

    const groupId = pilgrim.groupId;
    const group = groupId ? await this.groupRepository.findOne({ where: { id: groupId } }) : null;

    let agency = group?.agencyId ? await this.agencyRepository.findOne({ where: { id: group.agencyId } }) : null;
    let guide = group?.guideId ? await this.agencyGuideRepository.findOne({ where: { id: group.guideId } }) : null;

    if (!agency && pilgrim.agencyId) {
      agency = await this.agencyRepository.findOne({ where: { id: pilgrim.agencyId } });
    }
    if (!guide && pilgrim.guideId) {
      guide = await this.agencyGuideRepository.findOne({ where: { id: pilgrim.guideId } });
    }

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
            guide = await this.agencyGuideRepository.findOne({ where: { id: activeReservation.guideId } });
          } else if (activeReservation.packId) {
            const pack = await this.packRepository.findOne({ where: { id: activeReservation.packId } });
            if (pack?.guideId) {
              guide = await this.agencyGuideRepository.findOne({ where: { id: pack.guideId } });
            }
          }
        }
      }
    }

    return { pilgrim, group, agency, guide };
  }

  async getMySosContacts(params: { currentUser: { userId: string; activeRole?: string } }) {
    if (params.currentUser?.activeRole !== UserRole.PELEGRIN) {
      throw new ForbiddenException('Only pilgrim can access SOS contacts');
    }

    const { pilgrim, group, agency, guide } = await this.resolvePilgrimContext(params.currentUser.userId);

    const accompagnants = await this.userRepository.find({
      where: { accompaniedPilgrimId: pilgrim.id as any },
      select: ['id', 'firstName', 'lastName', 'phoneNumber', 'photo', 'uniqueIdentifier'],
    });

    return {
      pilgrim: {
        id: pilgrim.id,
        firstName: pilgrim.firstName,
        lastName: pilgrim.lastName,
        phoneNumber: pilgrim.phoneNumber,
        photo: pilgrim.photo,
        uniqueIdentifier: pilgrim.uniqueIdentifier,
      },
      group: group ? { id: group.id, name: (group as any).name } : null,
      agency: agency
        ? {
            id: agency.id,
            fullName: agency.fullName,
            agencyName: agency.agencyName,
            phoneNumber: agency.phoneNumber,
            agencyCode: agency.agencyCode,
            agencyLicense: agency.agencyLicense,
          }
        : null,
      guide: guide
        ? {
            id: guide.id,
            fullName: guide.fullName,
            firstName: guide.firstName,
            lastName: guide.lastName,
            phone: guide.phone || guide.phoneNumber,
            phoneNumber: guide.phoneNumber,
            email: guide.email,
            guideUserId: guide.guideUserId,
          }
        : null,
      accompagnants: (accompagnants || []).map((a) => ({
        id: a.id,
        firstName: a.firstName,
        lastName: a.lastName,
        phoneNumber: a.phoneNumber,
        photo: a.photo,
        uniqueIdentifier: a.uniqueIdentifier,
      })),
    };
  }

  async triggerSos(params: {
    currentUser: { userId: string; activeRole?: string };
    payload: SosTriggerPayload;
  }) {
    if (params.currentUser?.activeRole !== UserRole.PELEGRIN) {
      throw new ForbiddenException('Only pilgrim can trigger SOS');
    }

    const { pilgrim, group, agency, guide } = await this.resolvePilgrimContext(params.currentUser.userId);

    const accompagnants = await this.userRepository.find({
      where: { accompaniedPilgrimId: pilgrim.id as any },
    });

    const pilgrimName =
      String(`${pilgrim.firstName || ''} ${pilgrim.lastName || ''}`).trim() || 'Pèlerin';

    const data: Record<string, any> & { type: NotificationEventType } = {
      type: 'sos',
      pilgrimUserId: String(pilgrim.id),
      pilgrimName,
      photo: pilgrim.photo,
      latitude: params.payload.latitude,
      longitude: params.payload.longitude,
      pilgrim: {
        id: pilgrim.id,
        firstName: pilgrim.firstName,
        lastName: pilgrim.lastName,
        photo: pilgrim.photo,
        uniqueIdentifier: pilgrim.uniqueIdentifier,
        phoneNumber: pilgrim.phoneNumber,
      },
      group: group ? { id: group.id, name: (group as any).name } : null,
      agency: agency
        ? {
            id: agency.id,
            fullName: agency.fullName,
            agencyName: agency.agencyName,
            phoneNumber: agency.phoneNumber,
            agencyCode: agency.agencyCode,
          }
        : null,
      guide: guide
        ? {
            id: guide.id,
            fullName: guide.fullName,
            firstName: guide.firstName,
            lastName: guide.lastName,
            phone: guide.phone || guide.phoneNumber,
            phoneNumber: guide.phoneNumber,
            email: guide.email,
            guideUserId: guide.guideUserId,
          }
        : null,
      location: {
        latitude: params.payload.latitude,
        longitude: params.payload.longitude,
        accuracy: params.payload.accuracy,
        deviceTimestamp: params.payload.deviceTimestamp,
        serverTimestamp: new Date().toISOString(),
      },
    };

    const title = 'Alerte SOS';
    const body = `SOS de ${pilgrimName}`;

    if (guide?.guideUserId) {
      await this.notificationService.sendToUser({
        userId: String(guide.guideUserId),
        payload: { title, body, data },
        channels: { socket: true, push: false },
      });
    }

    for (const acc of accompagnants || []) {
      await this.notificationService.sendToUser({
        userId: String(acc.id),
        payload: { title, body, data },
        channels: { socket: true, push: false },
      });
    }

    this.logger.log(
      JSON.stringify({
        msg: 'sos_triggered',
        pilgrimUserId: pilgrim.id,
        guideUserId: guide?.guideUserId || null,
        accompagnants: (accompagnants || []).map((a) => a.id),
      }),
    );

    return {
      ok: true,
      notified: {
        guideUserId: guide?.guideUserId || null,
        accompagnantUserIds: (accompagnants || []).map((a) => a.id),
      },
      data,
    };
  }
}
