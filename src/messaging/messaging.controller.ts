import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Delete } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { SendMessageDto } from './dto/send-message.dto';
import { MessagingGateway } from './messaging.gateway';
import { MessagingService } from './messaging.service';

@Controller('messaging')
@UseGuards(JwtAuthGuard)
export class MessagingController {
  constructor(
    private readonly messagingService: MessagingService,
    private readonly messagingGateway: MessagingGateway,
  ) {}

  @Get('conversations')
  async getMyConversations(@CurrentUser() user: { userId: string; activeRole?: string }) {
    return this.messagingService.getMyConversations(user);
  }

  @Get('conversations/archived')
  async getArchivedConversations(@CurrentUser() user: { userId: string; activeRole?: string }) {
    return this.messagingService.getArchivedConversations(user);
  }

  @Get('support/conversations')
  async getSupportConversations(@CurrentUser() user: { userId: string; activeRole?: string }) {
    return this.messagingService.getSupportConversations(user);
  }

  @Get('conversations/:conversationId')
  async getConversation(
    @CurrentUser() user: { userId: string; activeRole?: string },
    @Param('conversationId') conversationId: string,
  ) {
    return this.messagingService.getConversationForUser(user, conversationId);
  }

  @Post('conversations/agency-guide')
  async getOrCreateAgencyGuideConversation(
    @CurrentUser() user: { userId: string; activeRole?: string },
    @Body() body: { guideId: string },
  ) {
    return this.messagingService.getOrCreateAgencyGuideConversation(user, body?.guideId);
  }

  @Post('conversations/group')
  async getOrCreateGroupConversation(
    @CurrentUser() user: { userId: string; activeRole?: string },
    @Body() body: { groupId: string },
  ) {
    return this.messagingService.getOrCreateGroupConversation(user, body?.groupId);
  }

  @Post('conversations/freelance-group')
  async getOrCreateFreelanceGroupConversation(
    @CurrentUser() user: { userId: string; activeRole?: string },
    @Body() body: { groupId: string },
  ) {
    return this.messagingService.getOrCreateFreelanceGroupConversation(user, body?.groupId);
  }

  @Post('conversations/guide-pilgrim')
  async getOrCreateGuidePilgrimConversation(
    @CurrentUser() user: { userId: string; activeRole?: string },
    @Body() body: { pilgrimUserId: string },
  ) {
    return this.messagingService.getOrCreateGuidePilgrimConversation(user, body?.pilgrimUserId);
  }
  @Post('conversations/companion')
  async getOrCreateCompanionConversation(
    @CurrentUser() user: { userId: string; activeRole?: string },
    @Body() body: { targetType: 'pelerin' | 'agence' | 'guide'; targetId: string },
  ) {
    return this.messagingService.getOrCreateCompanionConversation(user, body?.targetType, body?.targetId);
  }

  @Post('support/conversations')
  async getOrCreateSupportConversation(
    @CurrentUser() user: { userId: string; activeRole?: string },
    @Body() body: { targetRole: 'pelerin' | 'agence' | 'guide'; targetId: string },
  ) {
    return this.messagingService.getOrCreateSupportConversation(user, body);
  }

  @Post('conversations/:conversationId/messages')
  async sendMessage(
    @CurrentUser() user: { userId: string; activeRole?: string },
    @Param('conversationId') conversationId: string,
    @Body() dto: SendMessageDto,
  ) {
    const payload = await this.messagingService.sendMessage(user, conversationId, dto);
    this.messagingGateway.emitMessageCreated(conversationId, payload);
    return payload;
  }

  @Post('conversations/:conversationId/archive')
  async archiveConversation(
    @CurrentUser() user: { userId: string; activeRole?: string },
    @Param('conversationId') conversationId: string,
  ) {
    const conversation = await this.messagingService.archiveConversation(user, conversationId);
    const payload = { conversation };
    this.messagingGateway.emitConversationArchived(payload);
    return payload;
  }

  @Post('conversations/:conversationId/unarchive')
  async unarchiveConversation(
    @CurrentUser() user: { userId: string; activeRole?: string },
    @Param('conversationId') conversationId: string,
  ) {
    const conversation = await this.messagingService.unarchiveConversation(user, conversationId);
    const payload = { conversation };
    this.messagingGateway.emitConversationUnarchived(payload);
    return payload;
  }

  @Delete('conversations/:conversationId')
  async deleteConversation(
    @CurrentUser() user: { userId: string; activeRole?: string },
    @Param('conversationId') conversationId: string,
  ) {
    const deleted = await this.messagingService.deleteConversation(user, conversationId);
    const payload = { conversation: { id: conversationId } };
    this.messagingGateway.emitConversationDeleted(payload);
    return deleted;
  }
}
