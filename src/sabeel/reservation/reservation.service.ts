import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdminAgenceRole, AdminAgenceUser } from '../../admin_agence/auth/entities/admin-agence-user.entity';
import { PackUmrah, PackUmrahStatus } from '../../admin_agence/pack_umrah/entities/pack-umrah.entity';
import { MessagingGateway } from '../../messaging/messaging.gateway';
import { MessagingService } from '../../messaging/messaging.service';
import { Conversation } from '../../messaging/entities/conversation.entity';
import { Message, MessageType } from '../../messaging/entities/message.entity';
import { MinioService } from '../../minio/minio.service';
import { Guide } from '../../sabeel-guide/auth/entities/guide.entity';
import { User } from '../auth/entities/user.entity';
import { CreateGuideReservationDto, CreateReservationDto } from './dto/create-reservation.dto';
import { Reservation, ReservationKind, ReservationStatus } from './entities/reservation.entity';
import { NotificationsGateway } from '../../common/gateways/notifications.gateway';

const DEFAULT_ADVANCE_RATE = 0.2;
const DEFAULT_APP_COMMISSION_RATE = 5;

@Injectable()
export class ReservationService {
  constructor(
    @InjectRepository(Reservation)
    private readonly reservationRepository: Repository<Reservation>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(AdminAgenceUser)
    private readonly agencyRepository: Repository<AdminAgenceUser>,
    @InjectRepository(PackUmrah)
    private readonly packRepository: Repository<PackUmrah>,
    @InjectRepository(Guide)
    private readonly guideRepository: Repository<Guide>,
    private readonly messagingService: MessagingService,
    private readonly messagingGateway: MessagingGateway,
    private readonly minioService: MinioService,
    private readonly notificationsGateway: NotificationsGateway,
  ) {}

  private isPilgrimRole(activeRole?: string) {
    return activeRole === 'pelerin' || activeRole === 'accompagnant';
  }

  private isGuideRole(activeRole?: string) {
    return activeRole === 'freelance' || activeRole === 'agency' || activeRole === 'guide';
  }

  private isAgencyRole(activeRole?: string) {
    return (
      activeRole === AdminAgenceRole.AGENCE ||
      activeRole === AdminAgenceRole.ADMIN ||
      activeRole === AdminAgenceRole.SUB_ADMIN
    );
  }

  private toNumber(value: string | number | undefined | null, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private buildReservationSummary(reservation: Reservation) {
    const pilgrim = (reservation as any)?.pilgrimUser as User | undefined;
    const pilgrimFirstName = pilgrim?.firstName ? String(pilgrim.firstName) : '';
    const pilgrimLastName = pilgrim?.lastName ? String(pilgrim.lastName) : '';
    const pilgrimImageUrl = pilgrim?.photo
      ? this.minioService.getPublicFileUrl('images', pilgrim.photo)
      : '';

    return {
      id: reservation.id,
      kind: reservation.kind,
      pilgrimUserId: reservation.pilgrimUserId,
      pilgrimFirstName,
      pilgrimLastName,
      pilgrimImageUrl,
      pilgrimName: reservation.pilgrimName,
      pilgrimEmail: reservation.pilgrimEmail,
      pilgrimPhone: reservation.pilgrimPhone,
      age: reservation.age,
      hasDisease: reservation.hasDisease,
      medications: reservation.medications,
      packageName: reservation.packageName,
      reservationDate: reservation.reservationDate,
      pilgrimCount: reservation.pilgrimCount,
      paymentType: reservation.paymentType,
      paymentMode: reservation.paymentMode,
      totalPrice: Number(reservation.totalPrice || 0),
      advanceAmount: Number(reservation.advanceAmount || 0),
      remainingAmount: Number(reservation.remainingAmount || 0),
      appCommissionAmount: Number(reservation.appCommissionAmount || 0),
      appCommissionRate: Number(reservation.appCommissionRate || DEFAULT_APP_COMMISSION_RATE),
      notes: reservation.notes,
      status: reservation.status,
      packId: reservation.packId,
      agencyId: reservation.agencyId,
      guideId: reservation.guideId,
      conversationId: reservation.conversationId,
      packImageUrl: reservation.packImageUrl,
      agencyImageUrl: reservation.agencyImageUrl,
      agencyName: reservation.agencyName,
      guideName: reservation.guideName,
      guideImageUrl: reservation.guideImageUrl,
      createdAt: reservation.createdAt,
      updatedAt: reservation.updatedAt,
    };
  }

  async createReservation(
    currentUser: { userId: string; activeRole?: string },
    dto: CreateReservationDto,
  ) {
    if (!this.isPilgrimRole(currentUser.activeRole)) {
      throw new ForbiddenException('Only pilgrims can create reservations');
    }

    const user = await this.userRepository.findOne({ where: { id: currentUser.userId } });
    if (!user) {
      throw new NotFoundException('Pilgrim not found');
    }

    const pack = await this.packRepository.findOne({ where: { id: dto.packId } });
    if (!pack || pack.status !== PackUmrahStatus.APPROVED || !pack.isVisible || pack.isArchived) {
      throw new NotFoundException('Pack not found');
    }

    const agency = await this.agencyRepository.findOne({ where: { id: pack.agencyId } });
    if (!agency || agency.activeRole !== AdminAgenceRole.AGENCE) {
      throw new NotFoundException('Agency not found');
    }

    const pilgrimCount = Math.max(1, this.toNumber(dto.pilgrimCount, 1));
    const unitPrice = this.toNumber(dto.unitPrice, this.toNumber(pack.price, 0));
    const totalPrice = this.toNumber(dto.totalPrice, unitPrice * pilgrimCount);
    const advanceAmount = this.toNumber(dto.advanceAmount, totalPrice * DEFAULT_ADVANCE_RATE);
    const remainingAmount = this.toNumber(dto.remainingAmount, Math.max(0, totalPrice - advanceAmount));
    const appCommissionRate = this.toNumber(dto.appCommissionRate, DEFAULT_APP_COMMISSION_RATE);
    const appCommissionAmount = this.toNumber(
      dto.appCommissionAmount,
      advanceAmount * (appCommissionRate / 100),
    );

    const packImageUrl = pack.imageUrl ? this.minioService.getPublicFileUrl('images', pack.imageUrl) : null;
    const agencyImageUrl = agency.profileImagePath
      ? this.minioService.getPublicFileUrl('images', agency.profileImagePath)
      : null;
    const agencyDisplayName = agency.agencyName || agency.fullName || 'Agence';
    const pilgrimName = dto.userName || `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Pèlerin';
    const pilgrimImageUrl = user.photo ? this.minioService.getPublicFileUrl('images', user.photo) : '';

    const conversation = await this.messagingService.createLockedReservationConversation({
      pilgrimUserId: currentUser.userId,
      agencyId: agency.id,
      pilgrimDisplayName: pilgrimName,
      pilgrimImageUrl,
      agencyDisplayName,
      agencyImageUrl: agencyImageUrl || '',
      packId: pack.id,
      packTitle: pack.title,
      packImageUrl: packImageUrl || '',
    });

    const reservation = this.reservationRepository.create({
      pilgrimUserId: currentUser.userId,
      agencyId: agency.id,
      packId: pack.id,
      guideId: null,
      guideName: '',
      guideImageUrl: '',
      kind: ReservationKind.PACK,
      conversationId: conversation.id,
      pilgrimName,
      pilgrimEmail: dto.userEmail || user.email || '',
      pilgrimPhone: dto.userPhone || user.phoneNumber || '',
      age: dto.userAge ? this.toNumber(dto.userAge) : null,
      pilgrimCount,
      hasDisease: dto.hasDisease === 'true',
      medications: dto.medications || '',
      notes: dto.specialRequests || '',
      paymentType: dto.paymentType || '',
      paymentMode: dto.paymentMode || '',
      unitPrice,
      totalPrice,
      advanceAmount,
      remainingAmount,
      appCommissionRate,
      appCommissionAmount,
      reservationDate: dto.reservationDate || pack.departureDate || '',
      packageName: pack.title,
      agencyName: agencyDisplayName,
      packImageUrl: packImageUrl || '',
      agencyImageUrl: agencyImageUrl || '',
      status: ReservationStatus.PENDING,
      respondedAt: null,
    });

    const savedReservation = await this.reservationRepository.save(reservation);
    const updatedConversation = await this.messagingService.attachReservationToConversation(
      conversation.id,
      savedReservation.id,
    );

    const reservationMessage = await this.messagingService.createSystemMessage({
      conversationId: updatedConversation.id,
      messageType: MessageType.RESERVATION_REQUEST,
      content: `Nouvelle demande de réservation pour ${pack.title}`,
      metadata: {
        reservation: this.buildReservationSummary(savedReservation),
      },
    });

    const payload = {
      reservation: this.buildReservationSummary(savedReservation),
      conversation: updatedConversation,
      message: reservationMessage,
    };

    this.messagingGateway.emitReservationCreated(agency.id, payload);
    this.messagingGateway.emitMessageCreated(updatedConversation.id, payload);

    // Send Local Socket Notification to Agency
    this.notificationsGateway.sendNotification(agency.id, {
      title: 'Nouvelle demande de réservation',
      body: `Pèlerin ${pilgrimName} a envoyé une demande pour le pack ${pack.title}`,
      data: {
        type: 'reservation',
        reservationId: savedReservation.id,
      },
    });

    return payload;
  }

  async createGuideReservation(
    currentUser: { userId: string; activeRole?: string },
    dto: CreateGuideReservationDto,
  ) {
    if (!this.isPilgrimRole(currentUser.activeRole)) {
      throw new ForbiddenException('Only pilgrims can create guide reservations');
    }

    const user = await this.userRepository.findOne({ where: { id: currentUser.userId } });
    if (!user) {
      throw new NotFoundException('Pilgrim not found');
    }

    const guide = await this.guideRepository.findOne({ where: { id: dto.guideId } });
    if (!guide) {
      throw new NotFoundException('Guide not found');
    }

    const pilgrimCount = Math.max(1, this.toNumber(dto.pilgrimCount, 1));
    const pilgrimName = dto.userName || `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Pèlerin';
    const pilgrimImageUrl = user.photo ? this.minioService.getPublicFileUrl('images', user.photo) : '';

    const guideDisplayName = `${guide.firstName || ''} ${guide.lastName || ''}`.trim() || 'Guide';
    const guideImageUrl = guide.photo ? this.minioService.getPublicFileUrl('images', guide.photo) : '';

    const conversation = await this.messagingService.createLockedGuideReservationConversation({
      pilgrimUserId: currentUser.userId,
      guideId: guide.id,
      pilgrimDisplayName: pilgrimName,
      pilgrimImageUrl,
      guideDisplayName,
      guideImageUrl,
    });

    const reservation = this.reservationRepository.create({
      pilgrimUserId: currentUser.userId,
      agencyId: null,
      packId: null,
      guideId: guide.id,
      guideName: guideDisplayName,
      guideImageUrl,
      kind: ReservationKind.GUIDE,
      conversationId: conversation.id,
      pilgrimName,
      pilgrimEmail: dto.userEmail || user.email || '',
      pilgrimPhone: dto.userPhone || user.phoneNumber || '',
      age: dto.userAge ? this.toNumber(dto.userAge) : null,
      pilgrimCount,
      hasDisease: dto.hasDisease === 'true',
      medications: dto.medications || '',
      notes: dto.specialRequests || '',
      paymentType: dto.paymentType || '',
      paymentMode: dto.paymentMode || '',
      unitPrice: 0,
      totalPrice: 0,
      advanceAmount: 0,
      remainingAmount: 0,
      appCommissionRate: DEFAULT_APP_COMMISSION_RATE,
      appCommissionAmount: 0,
      reservationDate: dto.reservationDate || '',
      packageName: 'Réservation guide',
      agencyName: '',
      packImageUrl: '',
      agencyImageUrl: '',
      status: ReservationStatus.PENDING,
      respondedAt: null,
    });

    const savedReservation = await this.reservationRepository.save(reservation);
    const updatedConversation = await this.messagingService.attachReservationToConversation(
      conversation.id,
      savedReservation.id,
    );

    const reservationMessage = await this.messagingService.createSystemMessage({
      conversationId: updatedConversation.id,
      messageType: MessageType.RESERVATION_REQUEST,
      content: `Nouvelle demande de réservation pour ${guideDisplayName}`,
      metadata: {
        reservation: this.buildReservationSummary(savedReservation),
      },
    });

    const payload = {
      reservation: this.buildReservationSummary(savedReservation),
      conversation: updatedConversation,
      message: reservationMessage,
    };

    this.messagingGateway.emitReservationCreated(guide.id, payload);
    this.messagingGateway.emitMessageCreated(updatedConversation.id, payload);

    this.notificationsGateway.sendNotification(guide.id, {
      title: 'Nouvelle demande de réservation',
      body: `Pèlerin ${pilgrimName} a envoyé une demande de réservation.`,
      data: {
        type: 'reservation',
        reservationId: savedReservation.id,
      },
    });

    return payload;
  }

  async getMyReservations(currentUser: { userId: string; activeRole?: string }) {
    if (!this.isPilgrimRole(currentUser.activeRole)) {
      throw new ForbiddenException('Only pilgrims can access their reservations');
    }

    const reservations = await this.reservationRepository.find({
      where: { pilgrimUserId: currentUser.userId },
      order: { createdAt: 'DESC' },
    });

    return reservations.map((reservation) => this.buildReservationSummary(reservation));
  }

  async getAgencyReservations(currentUser: { userId: string; activeRole?: string }) {
    if (!this.isAgencyRole(currentUser.activeRole)) {
      throw new ForbiddenException('Only agencies can access reservation requests');
    }

    const reservations = await this.reservationRepository.find({
      where: { agencyId: currentUser.userId },
      order: { createdAt: 'DESC' },
    });

    return reservations.map((reservation) => this.buildReservationSummary(reservation));
  }

  async getGuideReservations(currentUser: { userId: string; activeRole?: string }) {
    if (!this.isGuideRole(currentUser.activeRole)) {
      throw new ForbiddenException('Only guides can access guide reservation requests');
    }

    const reservations = await this.reservationRepository.find({
      where: { guideId: currentUser.userId, kind: ReservationKind.GUIDE },
      relations: {
        pilgrimUser: true,
      },
      order: { createdAt: 'DESC' },
    });

    return reservations.map((reservation) => this.buildReservationSummary(reservation));
  }

  async updateReservationStatus(
    currentUser: { userId: string; activeRole?: string },
    reservationId: string,
    status: ReservationStatus.ACCEPTED | ReservationStatus.REJECTED,
  ) {
    if (!this.isAgencyRole(currentUser.activeRole)) {
      throw new ForbiddenException('Only agencies can validate reservation requests');
    }

    const reservation = await this.reservationRepository.findOne({ where: { id: reservationId } });
    if (!reservation) {
      throw new NotFoundException('Reservation not found');
    }

    if (!reservation.agencyId || reservation.agencyId !== currentUser.userId) {
      throw new ForbiddenException('You can only manage your own reservation requests');
    }

    reservation.status = status;
    reservation.respondedAt = new Date();
    const savedReservation = await this.reservationRepository.save(reservation);

    if (status === ReservationStatus.ACCEPTED) {
      await this.userRepository.update(reservation.pilgrimUserId, {
        agencyId: reservation.agencyId,
      });
    }

    let conversation: Conversation | null = null;
    let systemMessage: Message | null = null;

    if (reservation.conversationId) {
      if (status === ReservationStatus.ACCEPTED) {
        conversation = await this.messagingService.unlockConversation(reservation.conversationId);
      } else {
        conversation = (await this.messagingService.getConversationForUser(
          { userId: reservation.agencyId, activeRole: 'agence' },
          reservation.conversationId,
        )).conversation;
      }

      systemMessage = await this.messagingService.createSystemMessage({
        conversationId: reservation.conversationId,
        messageType: MessageType.RESERVATION_STATUS,
        content:
          status === ReservationStatus.ACCEPTED
            ? `Votre réservation pour ${reservation.packageName} a été acceptée.`
            : `Votre réservation pour ${reservation.packageName} a été refusée.`,
        metadata: {
          reservation: this.buildReservationSummary(savedReservation),
        },
      });

      this.messagingGateway.emitReservationUpdated(reservation.conversationId, {
        reservation: this.buildReservationSummary(savedReservation),
        conversation,
        message: systemMessage,
      });

      // Send Local Socket Notification to Pilgrim
      this.notificationsGateway.sendNotification(reservation.pilgrimUserId, {
        title: status === ReservationStatus.ACCEPTED ? 'Réservation acceptée' : 'Réservation refusée',
        body: status === ReservationStatus.ACCEPTED
          ? `Votre réservation pour ${reservation.packageName} a été acceptée par l'agence.`
          : `Votre réservation pour ${reservation.packageName} a été refusée.`,
        data: {
          type: 'reservation',
          reservationId: reservation.id,
        },
      });
    }

    return {
      reservation: this.buildReservationSummary(savedReservation),
      conversation,
      message: systemMessage,
    };
  }

  async updateGuideReservationStatus(
    currentUser: { userId: string; activeRole?: string },
    reservationId: string,
    status: ReservationStatus.ACCEPTED | ReservationStatus.REJECTED,
  ) {
    if (!this.isGuideRole(currentUser.activeRole)) {
      throw new ForbiddenException('Only guides can validate guide reservation requests');
    }

    const reservation = await this.reservationRepository.findOne({ where: { id: reservationId } });
    if (!reservation) {
      throw new NotFoundException('Reservation not found');
    }

    if (reservation.kind !== ReservationKind.GUIDE) {
      throw new ForbiddenException('Not a guide reservation');
    }

    if (!reservation.guideId || reservation.guideId !== currentUser.userId) {
      throw new ForbiddenException('You can only manage your own guide reservation requests');
    }

    reservation.status = status;
    reservation.respondedAt = new Date();
    const savedReservation = await this.reservationRepository.save(reservation);

    if (status === ReservationStatus.ACCEPTED) {
      await this.userRepository.update(reservation.pilgrimUserId, {
        guideId: reservation.guideId,
      });
    }

    let conversation: Conversation | null = null;
    let systemMessage: Message | null = null;

    if (reservation.conversationId) {
      if (status === ReservationStatus.ACCEPTED) {
        conversation = await this.messagingService.unlockConversation(reservation.conversationId);
      } else {
        conversation = (await this.messagingService.getConversationForUser(
          { userId: reservation.guideId, activeRole: 'freelance' },
          reservation.conversationId,
        )).conversation;
      }

      systemMessage = await this.messagingService.createSystemMessage({
        conversationId: reservation.conversationId,
        messageType: MessageType.RESERVATION_STATUS,
        content:
          status === ReservationStatus.ACCEPTED
            ? `Votre réservation avec ${reservation.guideName || 'le guide'} a été acceptée.`
            : `Votre réservation avec ${reservation.guideName || 'le guide'} a été refusée.`,
        metadata: {
          reservation: this.buildReservationSummary(savedReservation),
        },
      });

      this.messagingGateway.emitReservationUpdated(reservation.conversationId, {
        reservation: this.buildReservationSummary(savedReservation),
        conversation,
        message: systemMessage,
      });

      this.notificationsGateway.sendNotification(reservation.pilgrimUserId, {
        title: status === ReservationStatus.ACCEPTED ? 'Réservation acceptée' : 'Réservation refusée',
        body: status === ReservationStatus.ACCEPTED
          ? `Votre réservation avec ${reservation.guideName || 'le guide'} a été acceptée.`
          : `Votre réservation avec ${reservation.guideName || 'le guide'} a été refusée.`,
        data: {
          type: 'reservation',
          reservationId: reservation.id,
        },
      });
    }

    return {
      reservation: this.buildReservationSummary(savedReservation),
      conversation,
      message: systemMessage,
    };
  }
}
