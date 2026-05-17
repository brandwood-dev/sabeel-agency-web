import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { Conversation, ConversationParticipantRole } from './entities/conversation.entity';
import { Message, MessageType } from './entities/message.entity';
import { SendMessageDto } from './dto/send-message.dto';
import { NotificationsGateway } from '../common/gateways/notifications.gateway';
import { MinioService } from '../minio/minio.service';
import { Guide } from '../sabeel-guide/auth/entities/guide.entity';
import { AdminAgenceUser } from '../admin_agence/auth/entities/admin-agence-user.entity';
import { User } from '../sabeel/auth/entities/user.entity';
import { AgencyGroup } from '../admin_agence/group/entities/group.entity';
import { AgencyGuide } from '../admin_agence/guide/entities/guide.entity';
import { FreelanceGroup } from '../sabeel-guide/freelance-groups/entities/freelance-group.entity';
import { FreelanceGroupMember } from '../sabeel-guide/freelance-groups/entities/freelance-group-member.entity';

@Injectable()
export class MessagingService {
  constructor(
    @InjectRepository(Conversation)
    private readonly conversationRepository: Repository<Conversation>,
    @InjectRepository(Message)
    private readonly messageRepository: Repository<Message>,
    @InjectRepository(Guide)
    private readonly guideRepository: Repository<Guide>,
    @InjectRepository(AdminAgenceUser)
    private readonly adminAgenceRepository: Repository<AdminAgenceUser>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(AgencyGroup)
    private readonly groupRepository: Repository<AgencyGroup>,
    @InjectRepository(AgencyGuide)
    private readonly agencyGuideRepository: Repository<AgencyGuide>,
    @InjectRepository(FreelanceGroup)
    private readonly freelanceGroupRepository: Repository<FreelanceGroup>,
    @InjectRepository(FreelanceGroupMember)
    private readonly freelanceGroupMemberRepository: Repository<FreelanceGroupMember>,
    private readonly notificationsGateway: NotificationsGateway,
    private readonly minioService: MinioService,
  ) {}

  private isSupportRole(activeRole?: string) {
    return activeRole === 'admin' || activeRole === 'sub_admin';
  }

  private async assertAccompagnantLinkedToPilgrimAsync(
    currentUser: { userId: string; activeRole?: string },
    pilgrimUserId?: string | null,
  ) {
    if (!this.isAccompagnantRole(currentUser.activeRole)) {
      return;
    }

    if (!pilgrimUserId) {
      throw new ForbiddenException('You are not allowed to access this conversation');
    }

    const me = await this.userRepository.findOne({ where: { id: currentUser.userId } });
    const accompaniedPilgrimId = (me as any)?.accompaniedPilgrimId as string | null | undefined;
    if (!accompaniedPilgrimId || String(accompaniedPilgrimId) !== String(pilgrimUserId)) {
      throw new ForbiddenException('You are not allowed to access this conversation');
    }
  }

  private isPilgrimRole(activeRole?: string) {
    return activeRole === 'pelerin';
  }

  private isAccompagnantRole(activeRole?: string) {
    return activeRole === 'accompagnant';
  }

  private isPilgrimOrAccompagnantRole(activeRole?: string) {
    return this.isPilgrimRole(activeRole) || this.isAccompagnantRole(activeRole);
  }

  async assertCanStartCall(currentUser: { userId: string; activeRole?: string }, targetUserId: string) {
    if (!targetUserId) {
      throw new NotFoundException('Target not found');
    }

    const isGuideCaller = this.isGuideRole(currentUser.activeRole);
    const isPilgrimCaller = this.isPilgrimOrAccompagnantRole(currentUser.activeRole);
    if (!isGuideCaller && !isPilgrimCaller) {
      throw new ForbiddenException('You are not allowed to start calls');
    }

    if (isGuideCaller) {
      const targetUser = await this.userRepository.findOne({ where: { id: targetUserId } });
      if (!targetUser) {
        throw new NotFoundException('User not found');
      }

      const targetGroupId = (targetUser as any)?.groupId as string | undefined;
      if (!targetGroupId) {
        throw new ForbiddenException('User is not assigned to a group');
      }

      const guideAgencyRows = await this.agencyGuideRepository.find({ where: { guideUserId: currentUser.userId } });
      const agencyGuideIds = guideAgencyRows.map((g) => g.id);
      if (!agencyGuideIds.length) {
        throw new ForbiddenException('Guide is not assigned to any group');
      }

      const groups = await this.groupRepository.find({ where: { guideId: In(agencyGuideIds) } as any });
      const allowedGroupIds = new Set(groups.map((g) => g.id));
      if (!allowedGroupIds.has(targetGroupId)) {
        throw new ForbiddenException('You are not allowed to call this user');
      }

      return;
    }

    // Pilgrim/accompagnant can call their assigned guide
    const callerUser = await this.userRepository.findOne({ where: { id: currentUser.userId } });
    if (!callerUser) {
      throw new NotFoundException('User not found');
    }

    const callerGroupId = (callerUser as any)?.groupId as string | undefined;
    if (!callerGroupId) {
      throw new ForbiddenException('User is not assigned to a group');
    }

    const group = await this.groupRepository.findOne({ where: { id: callerGroupId } });
    if (!group?.guideId) {
      throw new ForbiddenException('No guide is assigned to your group');
    }

    const agencyGuide = await this.agencyGuideRepository.findOne({ where: { id: group.guideId } });
    const assignedGuideUserId = agencyGuide?.guideUserId;
    if (!assignedGuideUserId) {
      throw new ForbiddenException('No guide is assigned to your group');
    }

    // IMPORTANT: targetUserId is the guide JWT subject (guides.id) stored as AgencyGuide.guideUserId
    if (String(assignedGuideUserId) !== String(targetUserId)) {
      throw new ForbiddenException('You are not allowed to call this user');
    }
  }

  async getOrCreateGuidePilgrimConversation(
    currentUser: { userId: string; activeRole?: string },
    pilgrimUserId: string,
  ) {
    if (!pilgrimUserId) {
      throw new NotFoundException('User not found');
    }

    // Same authorization as calls: guide can only reach pilgrims from their groups
    await this.assertCanStartCall(currentUser, pilgrimUserId);

    const existing = await this.conversationRepository.findOne({
      where: {
        pilgrimUserId,
        guideId: currentUser.userId,
        agencyId: IsNull(),
        reservationId: IsNull(),
        groupId: IsNull(),
        isArchived: false,
      } as any,
    });
    if (existing) {
      return { conversation: existing };
    }

    const pilgrim = await this.userRepository.findOne({ where: { id: pilgrimUserId } });
    if (!pilgrim) {
      throw new NotFoundException('User not found');
    }

    const agencyGuide = await this.agencyGuideRepository.findOne({ where: { guideUserId: currentUser.userId } });
    const guideDisplayName = agencyGuide?.fullName || `${agencyGuide?.firstName || ''} ${agencyGuide?.lastName || ''}`.trim();
    const guideImageUrl = agencyGuide?.photo || agencyGuide?.profileImageUrl || '';

    const pilgrimDisplayName = `${(pilgrim as any)?.firstName || ''} ${(pilgrim as any)?.lastName || ''}`.trim();
    const pilgrimImageUrl = (pilgrim as any)?.photo || '';

    const conversation = this.conversationRepository.create({
      reservationId: null,
      groupId: null,
      pilgrimUserId: pilgrim.id,
      agencyId: null,
      guideId: currentUser.userId,
      supportAdminId: null,
      agencyDisplayName: '',
      agencyImageUrl: '',
      guideDisplayName,
      guideImageUrl,
      pilgrimDisplayName,
      pilgrimImageUrl,
      supportDisplayName: '',
      supportImageUrl: '',
      packId: null,
      groupName: '',
      groupImageUrl: '',
      packTitle: '',
      packImageUrl: '',
      isLocked: false,
      lockedReason: null,
      // This conversation belongs to the pilgrim inbox (not accompagnant).
      // We keep createdByRole=PILGRIM to avoid mixing inboxes across active roles.
      createdByRole: ConversationParticipantRole.PILGRIM,
    } as any);

    const saved = await this.conversationRepository.save(conversation);
    return { conversation: saved };
  }

  async getOrCreateFreelanceGroupConversation(currentUser: { userId: string; activeRole?: string }, groupId: string) {
    if (!groupId) {
      throw new NotFoundException('Group not found');
    }

    const isPilgrimOrAccompagnant = this.isPilgrimOrAccompagnantRole(currentUser.activeRole);
    const isGuide = this.isGuideRole(currentUser.activeRole);

    if (!isPilgrimOrAccompagnant && !isGuide) {
      throw new ForbiddenException('Only pilgrims and guides can access group conversations');
    }

    const group = await this.freelanceGroupRepository.findOne({ where: { id: groupId } });
    if (!group) {
      throw new NotFoundException('Group not found');
    }

    if (isGuide) {
      if (group.guideUserId !== currentUser.userId) {
        throw new ForbiddenException('You are not assigned to this group');
      }
    }

    if (isPilgrimOrAccompagnant) {
      const row = await this.freelanceGroupMemberRepository.findOne({
        where: { groupId: group.id, pilgrimUserId: currentUser.userId } as any,
      });
      if (!row) {
        throw new ForbiddenException('You are not in this group');
      }
    }

    const existing = await this.conversationRepository.findOne({
      where: { freelanceGroupId: group.id, isArchived: false } as any,
    });
    if (existing) {
      return { conversation: existing };
    }

    let guideDisplayName = '';
    let guideImageUrl = '';
    if (isGuide) {
      const guide = await this.guideRepository.findOne({ where: { id: currentUser.userId } });
      guideDisplayName = `${guide?.firstName || ''} ${guide?.lastName || ''}`.trim();
      guideImageUrl = guide?.photo || '';
    }

    const conversation = this.conversationRepository.create({
      reservationId: null,
      groupId: null,
      freelanceGroupId: group.id,
      pilgrimUserId: null,
      agencyId: null,
      guideId: isGuide ? currentUser.userId : null,
      supportAdminId: null,
      agencyDisplayName: '',
      agencyImageUrl: '',
      guideDisplayName,
      guideImageUrl,
      pilgrimDisplayName: '',
      pilgrimImageUrl: '',
      supportDisplayName: '',
      supportImageUrl: '',
      packId: null,
      groupName: group.name,
      groupImageUrl: group.imageUrl || '',
      packTitle: '',
      packImageUrl: '',
      isLocked: false,
      lockedReason: null,
      createdByRole: isGuide
        ? ConversationParticipantRole.GUIDE
        : this.isAccompagnantRole(currentUser.activeRole)
          ? ConversationParticipantRole.ACCOMPAGNANT
          : ConversationParticipantRole.PILGRIM,
    } as any);

    const saved = await this.conversationRepository.save(conversation);
    return { conversation: saved };
  }

  async getOrCreateGroupConversation(currentUser: { userId: string; activeRole?: string }, groupId: string) {
    if (!groupId) {
      throw new NotFoundException('Group not found');
    }

    const isPilgrimOrAccompagnant = this.isPilgrimOrAccompagnantRole(currentUser.activeRole);
    const isGuide = this.isGuideRole(currentUser.activeRole);

    if (!isPilgrimOrAccompagnant && !isGuide) {
      throw new ForbiddenException('Only pilgrims and guides can access group conversations');
    }

    const group = await this.groupRepository.findOne({ where: { id: groupId } });
    if (!group) {
      throw new NotFoundException('Group not found');
    }

    if (isPilgrimOrAccompagnant) {
      const user = await this.userRepository.findOne({ where: { id: currentUser.userId } });
      if (!user) throw new NotFoundException('User not found');

      const isAccompagnant = this.isAccompagnantRole(currentUser.activeRole);
      if (!isAccompagnant && (user as any).groupId !== group.id) {
        throw new ForbiddenException('You are not in this group');
      }

      if (isAccompagnant && (user as any).groupId !== group.id) {
        const accompaniedPilgrimId = (user as any)?.accompaniedPilgrimId as string | null | undefined;
        if (!accompaniedPilgrimId) {
          throw new ForbiddenException('You are not in this group');
        }
        const pilgrim = await this.userRepository.findOne({ where: { id: accompaniedPilgrimId } });
        if (!pilgrim || (pilgrim as any).groupId !== group.id) {
          throw new ForbiddenException('You are not in this group');
        }
      }
    }

    let guideId: string | null = null;
    let guideDisplayName = '';
    let guideImageUrl = '';

    if (isGuide) {
      const agencyGuide = await this.agencyGuideRepository.findOne({ where: { id: group.guideId } });
      if (!agencyGuide) {
        throw new ForbiddenException('No guide is assigned to this group');
      }
      if (agencyGuide.guideUserId !== currentUser.userId) {
        throw new ForbiddenException('You are not assigned to this group');
      }
      guideId = currentUser.userId;
      guideDisplayName = agencyGuide.fullName || `${agencyGuide.firstName || ''} ${agencyGuide.lastName || ''}`.trim();
      guideImageUrl = agencyGuide.photo || agencyGuide.profileImageUrl || '';
    }

    const existing = await this.conversationRepository.findOne({
      where: { groupId: group.id, isArchived: false },
    });
    if (existing) {
      return { conversation: existing };
    }

    const conversation = this.conversationRepository.create({
      reservationId: null,
      groupId: group.id,
      pilgrimUserId: null,
      agencyId: null,
      guideId,
      supportAdminId: null,
      agencyDisplayName: '',
      agencyImageUrl: '',
      guideDisplayName,
      guideImageUrl,
      pilgrimDisplayName: '',
      pilgrimImageUrl: '',
      supportDisplayName: '',
      supportImageUrl: '',
      packId: null,
      groupName: group.name,
      groupImageUrl: group.imageUrl || '',
      packTitle: '',
      packImageUrl: '',
      isLocked: false,
      lockedReason: null,
      createdByRole: isGuide
        ? ConversationParticipantRole.GUIDE
        : this.isAccompagnantRole(currentUser.activeRole)
          ? ConversationParticipantRole.ACCOMPAGNANT
          : ConversationParticipantRole.PILGRIM,
    } as any);

    const saved = await this.conversationRepository.save(conversation);
    return { conversation: saved };
  }

  // NOTE: isPilgrimRole / isAccompagnantRole are defined above to keep inboxes separated.

  async getOrCreateCompanionConversation(currentUser: { userId: string; activeRole?: string }, targetType: 'pelerin' | 'agence' | 'guide', targetId: string) {
    if (!this.isAccompagnantRole(currentUser.activeRole)) {
      throw new ForbiddenException('Only accompagnants can create companion conversations');
    }

    const where: any = {
      pilgrimUserId: currentUser.userId,
      isArchived: false,
      createdByRole: ConversationParticipantRole.ACCOMPAGNANT,
    };

    if (targetType === 'pelerin') {
      where.targetPilgrimUserId = targetId;
    } else if (targetType === 'agence') {
      where.agencyId = targetId;
    } else if (targetType === 'guide') {
      where.guideId = targetId;
    }

    const existing = await this.conversationRepository.findOne({ where });
    if (existing) {
      return { conversation: existing };
    }

    // Create new conversation
    const companion = await this.userRepository.findOne({ where: { id: currentUser.userId } });
    if (!companion) throw new NotFoundException('Companion not found');

    let targetDisplayName = '';
    let targetImageUrl = '';

    const convData: any = {
      pilgrimUserId: currentUser.userId,
      pilgrimDisplayName: `${companion.firstName || ''} ${companion.lastName || ''}`.trim(),
      pilgrimImageUrl: companion.photo || '',
      createdByRole: ConversationParticipantRole.ACCOMPAGNANT,
      isLocked: false,
    };

    if (targetType === 'pelerin') {
      const target = await this.userRepository.findOne({ where: { id: targetId } });
      if (!target) throw new NotFoundException('Pilgrim not found');
      convData.targetPilgrimUserId = target.id;
      targetDisplayName = `${target.firstName || ''} ${target.lastName || ''}`.trim();
      targetImageUrl = target.photo || '';
      // For companion-to-pilgrim, we might want to store target names somewhere or just use them in frontend
      // In this rigid entity, maybe we can use guideDisplayName/ImageUrl as a hack or just rely on frontend fetching target info
      // Actually, let's use the fields we have:
      convData.guideDisplayName = targetDisplayName; // HACK: reusing guide field for target pilgrim name
      convData.guideImageUrl = targetImageUrl;
    } else if (targetType === 'agence') {
      const target = await this.adminAgenceRepository.findOne({ where: { id: targetId } });
      if (!target) throw new NotFoundException('Agency not found');
      convData.agencyId = target.id;
      convData.agencyDisplayName = target.agencyName || target.fullName || '';
      convData.agencyImageUrl = target.profileImagePath || '';
    } else if (targetType === 'guide') {
      const target = await this.guideRepository.findOne({ where: { id: targetId } });
      if (!target) throw new NotFoundException('Guide not found');
      convData.guideId = target.id;
      convData.guideDisplayName = `${target.firstName || ''} ${target.lastName || ''}`.trim();
      convData.guideImageUrl = target.photo || '';
    }

    const conversation = this.conversationRepository.create(convData);
    const saved = await this.conversationRepository.save(conversation);
    return { conversation: saved };
  }

  async getOrCreateAgencyGuideConversation(currentUser: { userId: string; activeRole?: string }, guideId: string) {
    if (!this.isAgencyRole(currentUser.activeRole)) {
      throw new ForbiddenException('Only agencies can create guide conversations');
    }

    if (!guideId) {
      throw new NotFoundException('Guide not found');
    }

    const agency = await this.adminAgenceRepository.findOne({ where: { id: currentUser.userId } });
    if (!agency) {
      throw new NotFoundException('Agency not found');
    }

    const guide = await this.guideRepository.findOne({ where: { id: guideId } });
    if (!guide) {
      throw new NotFoundException('Guide not found');
    }

    if (!guide.agencyId || guide.agencyId !== agency.id) {
      throw new ForbiddenException('Guide is not attached to your agency');
    }

    const existing = await this.conversationRepository.findOne({
      where: { agencyId: agency.id, guideId: guide.id, pilgrimUserId: IsNull(), reservationId: IsNull() },
    });
    if (existing) {
      return { conversation: existing };
    }

    const conversation = this.conversationRepository.create({
      reservationId: null,
      pilgrimUserId: null,
      agencyId: agency.id,
      guideId: guide.id,
      agencyDisplayName: agency.agencyName || agency.fullName || '',
      agencyImageUrl: agency.profileImagePath || '',
      guideDisplayName: `${guide.firstName || ''} ${guide.lastName || ''}`.trim(),
      guideImageUrl: guide.photo || '',
      packId: null,
      packTitle: '',
      packImageUrl: '',
      isLocked: false,
      lockedReason: null,
      createdByRole: ConversationParticipantRole.AGENCY,
    } as any);

    const saved = await this.conversationRepository.save(conversation);
    return { conversation: saved };
  }

  private isGuideRole(activeRole?: string) {
    return activeRole === 'freelance' || activeRole === 'agency' || activeRole === 'guide';
  }

  async archiveConversation(currentUser: { userId: string; activeRole?: string }, conversationId: string) {
    const conversation = await this.conversationRepository.findOne({ where: { id: conversationId } });
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }
    this.assertParticipant(conversation, currentUser);
    await this.assertAccompagnantLinkedToPilgrimAsync(currentUser, conversation.pilgrimUserId);
    await this.assertGroupParticipantAsync(conversation, currentUser);
    conversation.isArchived = true;
    return this.conversationRepository.save(conversation);
  }

  async createLockedGuideReservationConversation(data: {
    pilgrimUserId: string;
    guideId: string;
    pilgrimDisplayName?: string;
    pilgrimImageUrl?: string;
    guideDisplayName?: string;
    guideImageUrl?: string;
  }) {
    const conversation = this.conversationRepository.create({
      reservationId: null,
      pilgrimUserId: data.pilgrimUserId,
      agencyId: null,
      guideId: data.guideId,
      agencyDisplayName: '',
      agencyImageUrl: '',
      guideDisplayName: data.guideDisplayName || '',
      guideImageUrl: data.guideImageUrl || '',
      pilgrimDisplayName: data.pilgrimDisplayName || '',
      pilgrimImageUrl: data.pilgrimImageUrl || '',
      packId: null,
      packTitle: '',
      packImageUrl: '',
      isLocked: true,
      lockedReason: 'reservation_pending',
      createdByRole: ConversationParticipantRole.PILGRIM,
    });

    return this.conversationRepository.save(conversation);
  }

  async unarchiveConversation(currentUser: { userId: string; activeRole?: string }, conversationId: string) {
    const conversation = await this.conversationRepository.findOne({ where: { id: conversationId } });
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }
    this.assertParticipant(conversation, currentUser);
    await this.assertGroupParticipantAsync(conversation, currentUser);
    conversation.isArchived = false;
    return this.conversationRepository.save(conversation);
  }

  async deleteConversation(currentUser: { userId: string; activeRole?: string }, conversationId: string) {
    const conversation = await this.conversationRepository.findOne({ where: { id: conversationId } });
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }
    this.assertParticipant(conversation, currentUser);
    await this.assertGroupParticipantAsync(conversation, currentUser);
    await this.messageRepository.delete({ conversationId });
    await this.conversationRepository.delete({ id: conversationId });
    return { id: conversationId };
  }

  private isAgencyRole(activeRole?: string) {
    return activeRole === 'agence' || activeRole === 'admin' || activeRole === 'sub_admin';
  }

  private assertParticipant(
    conversation: Conversation,
    currentUser: { userId: string; activeRole?: string },
  ) {
    const isPilgrim = this.isPilgrimRole(currentUser.activeRole);
    const isAccompagnant = this.isAccompagnantRole(currentUser.activeRole);
    const isAgency = this.isAgencyRole(currentUser.activeRole);
    const isGuide = this.isGuideRole(currentUser.activeRole);
    const isSupport = this.isSupportRole(currentUser.activeRole);

    const allowed =
      (isPilgrim &&
        (conversation.pilgrimUserId === currentUser.userId || conversation.targetPilgrimUserId === currentUser.userId) &&
        // Backward compatible: older rows might have createdByRole=GUIDE
        // but still represent a pilgrim inbox conversation.
        (conversation.createdByRole === ConversationParticipantRole.PILGRIM ||
          conversation.createdByRole === ConversationParticipantRole.GUIDE ||
          conversation.createdByRole === ConversationParticipantRole.ACCOMPAGNANT)) ||
      (isAccompagnant &&
        (conversation.pilgrimUserId === currentUser.userId || conversation.targetPilgrimUserId === currentUser.userId) &&
        conversation.createdByRole === ConversationParticipantRole.ACCOMPAGNANT) ||
      (isAgency && conversation.agencyId === currentUser.userId) ||
      (isGuide && conversation.guideId === currentUser.userId);

    const allowedViaSupport = isSupport && conversation.supportAdminId === currentUser.userId;

    const isGroupConversation = Boolean(conversation.groupId || (conversation as any).freelanceGroupId);

    if (allowed || allowedViaSupport) {
      return;
    }

    if (!isGroupConversation) {
      // Allow accompagnant access to their accompanied pilgrim conversations.
      // The actual validation is done asynchronously in assertAccompagnantLinkedToPilgrimAsync.
      if (isAccompagnant && conversation.pilgrimUserId) {
        return;
      }
      throw new ForbiddenException('You are not allowed to access this conversation');
    }

    // Group conversations: validate group membership
    if (isAgency) {
      throw new ForbiddenException('Agencies are not allowed to access group conversations');
    }

    if (isPilgrim || isAccompagnant) {
      // pilgrim must have groupId == conversation.groupId
      // Note: currentUser.userId is the pilgrim user id in JWT
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      return;
    }

    if (isGuide) {
      // Guide validation is handled in send/get methods via DB lookup (async)
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      return;
    }
  }

  private async assertGroupParticipantAsync(
    conversation: Conversation,
    currentUser: { userId: string; activeRole?: string },
  ) {
    const freelanceGroupId = (conversation as any).freelanceGroupId as string | null | undefined;
    if (!conversation.groupId && !freelanceGroupId) return;

    const isPilgrimOrAccompagnant = this.isPilgrimOrAccompagnantRole(currentUser.activeRole);
    const isGuide = this.isGuideRole(currentUser.activeRole);
    const isAgency = this.isAgencyRole(currentUser.activeRole);

    if (isAgency) {
      throw new ForbiddenException('Agencies are not allowed to access group conversations');
    }

    if (freelanceGroupId) {
      const group = await this.freelanceGroupRepository.findOne({ where: { id: freelanceGroupId } });
      if (!group) {
        if (isGuide && conversation.guideId === currentUser.userId) {
          return;
        }
        throw new NotFoundException('Group not found');
      }

      if (isPilgrimOrAccompagnant) {
        const row = await this.freelanceGroupMemberRepository.findOne({
          where: { groupId: group.id, pilgrimUserId: currentUser.userId } as any,
        });
        if (!row) throw new ForbiddenException('You are not in this group');
        return;
      }

      if (isGuide) {
        if (group.guideUserId !== currentUser.userId) {
          throw new ForbiddenException('You are not assigned to this group');
        }
        return;
      }

      throw new ForbiddenException('You are not allowed to access this conversation');
    }

    if (!conversation.groupId) {
      throw new NotFoundException('Group not found');
    }

    const group = await this.groupRepository.findOne({ where: { id: conversation.groupId } });
    if (!group) {
      if (isGuide && conversation.guideId === currentUser.userId) {
        return;
      }
      throw new NotFoundException('Group not found');
    }

    if (isPilgrimOrAccompagnant) {
      const user = await this.userRepository.findOne({ where: { id: currentUser.userId } });
      if (!user) throw new NotFoundException('User not found');
      if ((user as any).groupId !== group.id) {
        throw new ForbiddenException('You are not in this group');
      }
      return;
    }

    if (isGuide) {
      if (!group.guideId) {
        throw new ForbiddenException('No guide is assigned to this group');
      }
      const agencyGuide = await this.agencyGuideRepository.findOne({ where: { id: group.guideId } });
      if (!agencyGuide) {
        throw new ForbiddenException('No guide is assigned to this group');
      }
      if (agencyGuide.guideUserId !== currentUser.userId) {
        throw new ForbiddenException('You are not assigned to this group');
      }
      return;
    }

    throw new ForbiddenException('You are not allowed to access this conversation');
  }

  async getSupportConversations(currentUser: { userId: string; activeRole?: string }) {
    if (!this.isSupportRole(currentUser.activeRole)) {
      throw new ForbiddenException('Only support admins can view support conversations');
    }

    const conversations = await this.conversationRepository.find({
      where: { supportAdminId: currentUser.userId, isArchived: false },
      order: { updatedAt: 'DESC' },
    });

    return Promise.all(
      conversations.map(async (conv) => {
        if (conv.agencyImageUrl && !conv.agencyImageUrl.startsWith('http')) {
          conv.agencyImageUrl = this.minioService.getPublicFileUrl('images', conv.agencyImageUrl);
        }
        if (conv.guideImageUrl && !conv.guideImageUrl.startsWith('http')) {
          conv.guideImageUrl = this.minioService.getPublicFileUrl('images', conv.guideImageUrl);
        }
        if (conv.supportImageUrl && !conv.supportImageUrl.startsWith('http')) {
          conv.supportImageUrl = this.minioService.getPublicFileUrl('images', conv.supportImageUrl);
        }
        if (conv.pilgrimImageUrl && !conv.pilgrimImageUrl.startsWith('http')) {
          conv.pilgrimImageUrl = this.minioService.getPublicFileUrl('images', conv.pilgrimImageUrl);
        }
        return conv;
      }),
    );
  }

  private async getGuideAgencyIds(guideUserId: string): Promise<string[]> {
    const rows = await this.agencyGuideRepository.find({ where: { guideUserId } });
    // AgencyGuide rows contain the agencyId the guide belongs to (agency space authorization)
    const ids = rows
      .map((r: any) => (r?.agencyId ? String(r.agencyId) : ''))
      .filter((id: string) => id);
    return Array.from(new Set(ids));
  }

  private async getGuideGroupConversations(guideUserId: string, archived: boolean): Promise<Conversation[]> {
    const guideAgencyRows = await this.agencyGuideRepository.find({ where: { guideUserId } });
    const agencyGuideIds = guideAgencyRows.map((g) => g.id);
    if (!agencyGuideIds.length) return [];

    const groups = await this.groupRepository.find({ where: { guideId: In(agencyGuideIds) } as any });
    const groupIds = groups.map((g) => g.id);
    if (!groupIds.length) return [];

    return this.conversationRepository.find({
      where: { groupId: In(groupIds), isArchived: archived } as any,
      order: { updatedAt: 'DESC' },
    });
  }

  async getGroupPilgrimUserIds(groupId: string) {
    if (!groupId) {
      return [] as string[];
    }

    const pilgrims = await this.userRepository.find({
      where: { groupId } as any,
      select: ['id'] as any,
    });

    return (pilgrims || []).map((p: any) => String(p.id)).filter(Boolean);
  }

  async getOrCreateSupportConversation(
    currentUser: { userId: string; activeRole?: string },
    data: { targetRole: 'pelerin' | 'agence' | 'guide'; targetId: string },
  ) {
    if (!this.isSupportRole(currentUser.activeRole)) {
      throw new ForbiddenException('Only support admins can create support conversations');
    }
    if (!data?.targetRole || !data?.targetId) {
      throw new NotFoundException('Target not found');
    }

    const existing = await this.conversationRepository.findOne({
      where: {
        supportAdminId: currentUser.userId,
        pilgrimUserId: data.targetRole === 'pelerin' ? data.targetId : IsNull(),
        agencyId: data.targetRole === 'agence' ? data.targetId : IsNull(),
        guideId: data.targetRole === 'guide' ? data.targetId : IsNull(),
        reservationId: IsNull(),
      },
    });
    if (existing) {
      return { conversation: existing };
    }

    const supportAdmin = await this.adminAgenceRepository.findOne({ where: { id: currentUser.userId } });
    const supportDisplayName = supportAdmin?.fullName || 'Support';
    const supportImageUrl = supportAdmin?.profileImagePath || '';

    let agencyDisplayName = '';
    let agencyImageUrl = '';
    let guideDisplayName = '';
    let guideImageUrl = '';
    let pilgrimDisplayName = '';
    let pilgrimImageUrl = '';
    let pilgrimUserId: string | null = null;
    let agencyId: string | null = null;
    let guideId: string | null = null;

    if (data.targetRole === 'agence') {
      const agency = await this.adminAgenceRepository.findOne({ where: { id: data.targetId } });
      if (!agency) throw new NotFoundException('Agency not found');
      agencyId = agency.id;
      agencyDisplayName = agency.agencyName || agency.fullName || '';
      agencyImageUrl = agency.profileImagePath || '';
    }
    if (data.targetRole === 'guide') {
      const guide = await this.guideRepository.findOne({ where: { id: data.targetId } });
      if (!guide) throw new NotFoundException('Guide not found');
      guideId = guide.id;
      guideDisplayName = `${guide.firstName || ''} ${guide.lastName || ''}`.trim();
      guideImageUrl = guide.photo || '';
    }
    if (data.targetRole === 'pelerin') {
      const user = await this.userRepository.findOne({ where: { id: data.targetId } });
      if (!user) throw new NotFoundException('User not found');
      pilgrimUserId = user.id;
      pilgrimDisplayName = `${user.firstName || ''} ${user.lastName || ''}`.trim();
      pilgrimImageUrl = user.photo || '';
    }

    const conversation = this.conversationRepository.create({
      reservationId: null,
      pilgrimUserId,
      agencyId,
      guideId,
      supportAdminId: currentUser.userId,
      agencyDisplayName,
      agencyImageUrl,
      guideDisplayName,
      guideImageUrl,
      pilgrimDisplayName,
      pilgrimImageUrl,
      supportDisplayName,
      supportImageUrl,
      packId: null,
      packTitle: '',
      packImageUrl: '',
      isLocked: false,
      lockedReason: null,
      createdByRole: ConversationParticipantRole.SYSTEM,
    } as any);

    const saved = await this.conversationRepository.save(conversation);
    return { conversation: saved };
  }

  async createLockedReservationConversation(data: {
    pilgrimUserId: string;
    agencyId: string;
    pilgrimDisplayName?: string;
    pilgrimImageUrl?: string;
    agencyDisplayName?: string;
    agencyImageUrl?: string;
    packId: string;
    packTitle?: string;
    packImageUrl?: string;
  }) {
    const conversation = this.conversationRepository.create({
      reservationId: null,
      pilgrimUserId: data.pilgrimUserId,
      agencyId: data.agencyId,
      guideId: null,
      agencyDisplayName: data.agencyDisplayName || '',
      agencyImageUrl: data.agencyImageUrl || '',
      guideDisplayName: '',
      guideImageUrl: '',
      pilgrimDisplayName: data.pilgrimDisplayName || '',
      pilgrimImageUrl: data.pilgrimImageUrl || '',
      packId: data.packId,
      packTitle: data.packTitle || '',
      packImageUrl: data.packImageUrl || '',
      isLocked: true,
      lockedReason: 'reservation_pending',
      createdByRole: ConversationParticipantRole.PILGRIM,
    });

    return this.conversationRepository.save(conversation);
  }

  async attachReservationToConversation(conversationId: string, reservationId: string) {
    const conversation = await this.conversationRepository.findOne({ where: { id: conversationId } });
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    conversation.reservationId = reservationId;
    return this.conversationRepository.save(conversation);
  }

  async unlockConversation(conversationId: string) {
    const conversation = await this.conversationRepository.findOne({ where: { id: conversationId } });
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    conversation.isLocked = false;
    conversation.lockedReason = null;
    return this.conversationRepository.save(conversation);
  }

  async getConversationForUser(
    currentUser: { userId: string; activeRole?: string },
    conversationId: string,
  ) {
    const conversation = await this.conversationRepository.findOne({
      where: { id: conversationId },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    this.assertParticipant(conversation, currentUser);
    await this.assertAccompagnantLinkedToPilgrimAsync(currentUser, conversation.pilgrimUserId);

    if (conversation.agencyImageUrl && !conversation.agencyImageUrl.startsWith('http')) {
      conversation.agencyImageUrl = this.minioService.getPublicFileUrl('images', conversation.agencyImageUrl);
    }
    if (conversation.guideImageUrl && !conversation.guideImageUrl.startsWith('http')) {
      conversation.guideImageUrl = this.minioService.getPublicFileUrl('images', conversation.guideImageUrl);
    }
    if (conversation.packImageUrl && !conversation.packImageUrl.startsWith('http')) {
      conversation.packImageUrl = this.minioService.getPublicFileUrl('images', conversation.packImageUrl);
    }

    if (conversation.groupImageUrl && !conversation.groupImageUrl.startsWith('http')) {
      conversation.groupImageUrl = this.minioService.getPublicFileUrl('images', conversation.groupImageUrl);
    }

    const messages = await this.messageRepository.find({
      where: { conversationId },
      order: { createdAt: 'ASC' },
    });

    return {
      conversation,
      messages,
    };
  }

  async getMyConversations(currentUser: { userId: string; activeRole?: string }) {
    try {
      let conversations: Conversation[] = [];
      if (this.isPilgrimOrAccompagnantRole(currentUser.activeRole)) {
        const directRole = this.isAccompagnantRole(currentUser.activeRole)
          ? ConversationParticipantRole.ACCOMPAGNANT
          : ConversationParticipantRole.PILGRIM;

        // Direct conversations are role-scoped (private inbox) using createdByRole.
        if (this.isAccompagnantRole(currentUser.activeRole)) {
          conversations = await this.conversationRepository.find({
            where: [
              {
                pilgrimUserId: currentUser.userId,
                isArchived: false,
                createdByRole: ConversationParticipantRole.ACCOMPAGNANT,
              },
              {
                targetPilgrimUserId: currentUser.userId,
                isArchived: false,
                createdByRole: ConversationParticipantRole.ACCOMPAGNANT,
              }
            ] as any,
            order: { updatedAt: 'DESC' },
          });
        } else {
          // Pilgrim inbox: include legacy GUIDE-created direct conversations too.
          conversations = await this.conversationRepository.find({
            where: [
              {
                pilgrimUserId: currentUser.userId,
                isArchived: false,
                createdByRole: In([directRole, ConversationParticipantRole.GUIDE]),
              },
              {
                targetPilgrimUserId: currentUser.userId,
                isArchived: false,
              }
            ] as any,
            order: { updatedAt: 'DESC' },
          });
        }

        const user = await this.userRepository.findOne({ where: { id: currentUser.userId } });
        const groupId = (user as any)?.groupId;
        if (groupId) {
          const groupConvs = await this.conversationRepository.find({
            where: { groupId, isArchived: false },
            order: { updatedAt: 'DESC' },
          });
          conversations = [...groupConvs, ...conversations];
        }

        const freelanceMemberRows = await this.freelanceGroupMemberRepository.find({
          where: { pilgrimUserId: currentUser.userId } as any,
        });
        const freelanceGroupIds = Array.from(
          new Set((freelanceMemberRows || []).map((r: any) => String(r.groupId)).filter(Boolean)),
        );
        if (freelanceGroupIds.length) {
          const freelanceGroupConvs = await this.conversationRepository.find({
            where: { freelanceGroupId: In(freelanceGroupIds), isArchived: false } as any,
            order: { updatedAt: 'DESC' },
          });
          conversations = [...freelanceGroupConvs, ...conversations];
        }
      } else if (this.isAgencyRole(currentUser.activeRole)) {
        conversations = await this.conversationRepository.find({
          where: { agencyId: currentUser.userId, isArchived: false },
          order: { updatedAt: 'DESC' },
        });
      } else if (this.isGuideRole(currentUser.activeRole)) {
        // IMPORTANT: Guides have 2 separate spaces in the app (freelance vs agency).
        // We must not mix conversations between them.
        const isAgencyGuide = currentUser.activeRole === 'agency';

        if (isAgencyGuide) {
          // Agency space: only agency/group conversations (never freelance direct conv)
          const directAgencyConvs = await this.conversationRepository.find({
            where: {
              guideId: currentUser.userId,
              isArchived: false,
              agencyId: In(await this.getGuideAgencyIds(currentUser.userId)),
            } as any,
            order: { updatedAt: 'DESC' },
          });

          const groupConvs = await this.getGuideGroupConversations(currentUser.userId, false);
          conversations = [...groupConvs, ...directAgencyConvs];
        } else {
          // Freelance space: direct conversations with pilgrims + freelance group conversations
          const directConvs = await this.conversationRepository.find({
            where: {
              guideId: currentUser.userId,
              isArchived: false,
              agencyId: IsNull(),
              groupId: IsNull(),
            } as any,
            order: { updatedAt: 'DESC' },
          });

          const freelanceGroups = await this.freelanceGroupRepository.find({
            where: { guideUserId: currentUser.userId } as any,
            select: ['id'] as any,
          });
          const freelanceGroupIds = Array.from(new Set((freelanceGroups || []).map((g: any) => String(g.id)).filter(Boolean)));
          const freelanceGroupConvs = freelanceGroupIds.length
            ? await this.conversationRepository.find({
                where: { freelanceGroupId: In(freelanceGroupIds), isArchived: false } as any,
                order: { updatedAt: 'DESC' },
              })
            : [];

          conversations = [...freelanceGroupConvs, ...directConvs];
        }
      }

      return Promise.all(
        conversations.map(async (conv) => {
          const freelanceGroupId = (conv as any).freelanceGroupId as string | null | undefined;
          if (freelanceGroupId && (!conv.groupName || !conv.groupImageUrl)) {
            const fg = await this.freelanceGroupRepository.findOne({ where: { id: freelanceGroupId } as any });
            if (fg) {
              conv.groupName = conv.groupName || fg.name;
              conv.groupImageUrl = conv.groupImageUrl || fg.imageUrl || '';
            }
          }

          if (conv.pilgrimUserId && (!conv.pilgrimDisplayName || !conv.pilgrimImageUrl)) {
            const user = await this.userRepository.findOne({ where: { id: conv.pilgrimUserId } });
            if (user) {
              conv.pilgrimDisplayName = conv.pilgrimDisplayName || `${user.firstName || ''} ${user.lastName || ''}`.trim();
              conv.pilgrimImageUrl = conv.pilgrimImageUrl || user.photo || '';
            }
          }
          if (conv.agencyImageUrl && !conv.agencyImageUrl.startsWith('http')) {
            conv.agencyImageUrl = this.minioService.getPublicFileUrl('images', conv.agencyImageUrl);
          }
          if (conv.guideImageUrl && !conv.guideImageUrl.startsWith('http')) {
            conv.guideImageUrl = this.minioService.getPublicFileUrl('images', conv.guideImageUrl);
          }
          if (conv.packImageUrl && !conv.packImageUrl.startsWith('http')) {
            conv.packImageUrl = this.minioService.getPublicFileUrl('images', conv.packImageUrl);
          }
          if (conv.groupImageUrl && !conv.groupImageUrl.startsWith('http')) {
            conv.groupImageUrl = this.minioService.getPublicFileUrl('images', conv.groupImageUrl);
          }
          if (conv.pilgrimImageUrl && !conv.pilgrimImageUrl.startsWith('http')) {
            conv.pilgrimImageUrl = this.minioService.getPublicFileUrl('images', conv.pilgrimImageUrl);
          }
          return conv;
        }),
      );
    } catch (error) {
      console.error('[MessagingService] getMyConversations error:', error);
      throw new BadRequestException(`Failed to get conversations: ${error.message}`);
    }
  }

  async getArchivedConversations(currentUser: { userId: string; activeRole?: string }) {
    let conversations: Conversation[] = [];
    if (this.isPilgrimOrAccompagnantRole(currentUser.activeRole)) {
      const directRole = this.isAccompagnantRole(currentUser.activeRole)
        ? ConversationParticipantRole.ACCOMPAGNANT
        : ConversationParticipantRole.PILGRIM;

      if (this.isAccompagnantRole(currentUser.activeRole)) {
        conversations = await this.conversationRepository.find({
          where: {
            pilgrimUserId: currentUser.userId,
            isArchived: true,
            createdByRole: directRole,
          } as any,
          order: { updatedAt: 'DESC' },
        });
      } else {
        conversations = await this.conversationRepository.find({
          where: {
            pilgrimUserId: currentUser.userId,
            isArchived: true,
            createdByRole: In([directRole, ConversationParticipantRole.GUIDE]),
          } as any,
          order: { updatedAt: 'DESC' },
        });
      }
    } else if (this.isAgencyRole(currentUser.activeRole)) {
      conversations = await this.conversationRepository.find({
        where: { agencyId: currentUser.userId, isArchived: true },
        order: { updatedAt: 'DESC' },
      });
    } else if (this.isGuideRole(currentUser.activeRole)) {
      const isAgencyGuide = currentUser.activeRole === 'agency';

      if (isAgencyGuide) {
        const directAgencyConvs = await this.conversationRepository.find({
          where: {
            guideId: currentUser.userId,
            isArchived: true,
            agencyId: In(await this.getGuideAgencyIds(currentUser.userId)),
          } as any,
          order: { updatedAt: 'DESC' },
        });

        const groupConvs = await this.getGuideGroupConversations(currentUser.userId, true);
        conversations = [...groupConvs, ...directAgencyConvs];
      } else {
        conversations = await this.conversationRepository.find({
          where: {
            guideId: currentUser.userId,
            isArchived: true,
            agencyId: IsNull(),
            groupId: IsNull(),
          } as any,
          order: { updatedAt: 'DESC' },
        });
      }
    }

    return Promise.all(
      conversations.map(async (conv) => {
        if (conv.pilgrimUserId && (!conv.pilgrimDisplayName || !conv.pilgrimImageUrl)) {
          const user = await this.userRepository.findOne({ where: { id: conv.pilgrimUserId } });
          if (user) {
            conv.pilgrimDisplayName = conv.pilgrimDisplayName || `${user.firstName || ''} ${user.lastName || ''}`.trim();
            conv.pilgrimImageUrl = conv.pilgrimImageUrl || user.photo || '';
          }
        }
        if (conv.agencyImageUrl && !conv.agencyImageUrl.startsWith('http')) {
          conv.agencyImageUrl = this.minioService.getPublicFileUrl('images', conv.agencyImageUrl);
        }
        if (conv.guideImageUrl && !conv.guideImageUrl.startsWith('http')) {
          conv.guideImageUrl = this.minioService.getPublicFileUrl('images', conv.guideImageUrl);
        }
        if (conv.packImageUrl && !conv.packImageUrl.startsWith('http')) {
          conv.packImageUrl = this.minioService.getPublicFileUrl('images', conv.packImageUrl);
        }
        if (conv.pilgrimImageUrl && !conv.pilgrimImageUrl.startsWith('http')) {
          conv.pilgrimImageUrl = this.minioService.getPublicFileUrl('images', conv.pilgrimImageUrl);
        }
        return conv;
      }),
    );
  }

  async sendMessage(
    currentUser: { userId: string; activeRole?: string },
    conversationId: string,
    dto: SendMessageDto,
  ) {
    const conversation = await this.conversationRepository.findOne({ where: { id: conversationId } });
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    this.assertParticipant(conversation, currentUser);

    if (conversation.isLocked) {
      throw new ForbiddenException('Messaging is locked until the reservation is accepted');
    }

    const senderRole = this.isSupportRole(currentUser.activeRole)
      ? ConversationParticipantRole.SYSTEM
      : this.isAgencyRole(currentUser.activeRole)
        ? ConversationParticipantRole.AGENCY
        : this.isGuideRole(currentUser.activeRole)
          ? ConversationParticipantRole.GUIDE
          : this.isAccompagnantRole(currentUser.activeRole)
            ? ConversationParticipantRole.ACCOMPAGNANT
            : ConversationParticipantRole.PILGRIM;

    const message = this.messageRepository.create({
      conversationId,
      senderUserId: currentUser.userId,
      senderRole,
      messageType: MessageType.TEXT,
      content: dto.content.trim(),
      metadata: null,
    });

    const savedMessage = await this.messageRepository.save(message);

    conversation.lastMessageText = savedMessage.content;
    conversation.lastMessageAt = savedMessage.createdAt;
    await this.conversationRepository.save(conversation);

    // Trigger Local Socket Notification
    this.sendSocketNotificationForMessage(conversation, savedMessage);

    return {
      conversation,
      message: savedMessage,
    };
  }

  private sendSocketNotificationForMessage(conversation: Conversation, message: Message) {
    try {
      const isSenderAgency = message.senderRole === ConversationParticipantRole.AGENCY;
      const isSenderGuide = message.senderRole === ConversationParticipantRole.GUIDE;
      const isSenderSupport = message.senderRole === ConversationParticipantRole.SYSTEM;

      let targetUserId: string | null = null;
      let senderName = 'Utilisateur';

      if (isSenderAgency) {
        targetUserId = conversation.pilgrimUserId || conversation.guideId;
        senderName = conversation.agencyDisplayName || 'Agence';
      } else if (isSenderGuide) {
        targetUserId = conversation.pilgrimUserId || conversation.agencyId;
        senderName = conversation.guideDisplayName || 'Guide';
      } else if (isSenderSupport) {
        targetUserId = conversation.pilgrimUserId || conversation.agencyId || conversation.guideId || null;
        senderName = conversation.supportDisplayName || 'Support';
      } else {
        targetUserId = conversation.agencyId || conversation.guideId || null;
        senderName = 'Pèlerin';
      }

      if (!targetUserId) {
        return;
      }

      this.notificationsGateway.sendNotification(targetUserId, {
        title: `Nouveau message de ${senderName}`,
        body: message.content,
        data: {
          type: 'chat',
          conversationId: conversation.id,
        },
      });
    } catch (error) {
      console.error('[MessagingService] Socket notification failed', error);
    }
  }

  async createSystemMessage(data: {
    conversationId: string;
    content: string;
    messageType: MessageType;
    metadata?: Record<string, any> | null;
  }) {
    const conversation = await this.conversationRepository.findOne({ where: { id: data.conversationId } });
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    const message = this.messageRepository.create({
      conversationId: data.conversationId,
      senderUserId: null,
      senderRole: ConversationParticipantRole.SYSTEM,
      messageType: data.messageType,
      content: data.content,
      metadata: data.metadata || null,
    });

    const savedMessage = await this.messageRepository.save(message);
    conversation.lastMessageText = savedMessage.content;
    conversation.lastMessageAt = savedMessage.createdAt;
    await this.conversationRepository.save(conversation);

    return savedMessage;
  }
}
