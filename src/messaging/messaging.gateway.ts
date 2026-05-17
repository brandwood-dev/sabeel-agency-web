import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Server, Socket } from 'socket.io';
import { MessagingService } from './messaging.service';
import { MessageType } from './entities/message.entity';

type CallSignalPayload = {
  callId: string;
  targetUserId: string;
  sdp?: any;
  candidate?: any;
  metadata?: any;
};

@WebSocketGateway({
  cors: {
    origin: true,
  },
  namespace: '/messaging',
})
export class MessagingGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(MessagingGateway.name);
  private readonly connectedClients = new Map<string, { userId: string; activeRole?: string }>();
  private readonly activeCalls = new Map<string, { callerUserId: string; calleeUserId: string }>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly messagingService: MessagingService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token =
        client.handshake.auth?.token ||
        client.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) {
        client.disconnect();
        return;
      }
      const payload = this.jwtService.verify(token, {
        secret: this.configService.get<string>('JWT_SECRET'),
      });

      const session = {
        userId: payload.sub,
        activeRole: payload.activeRole,
      };

      this.connectedClients.set(client.id, session);
      client.join(`messaging-user-${session.userId}`);
      client.emit('connection_ack', {
        userId: session.userId,
        activeRole: session.activeRole,
      });
    } catch (error) {
      this.logger.warn(`Unauthorized messaging connection attempt: ${error.message}`);
      client.disconnect();
    }
  }

  @SubscribeMessage('call_offer')
  async handleCallOffer(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: CallSignalPayload,
  ) {
    const session = this.connectedClients.get(client.id);
    if (!session || !body?.callId || !body?.targetUserId) {
      client.emit('call_error', { message: 'Invalid call offer' });
      return;
    }

    try {
      await this.messagingService.assertCanStartCall(session, body.targetUserId);
    } catch (error) {
      client.emit('call_error', { message: error?.message || 'Not allowed to start call' });
      return;
    }

    // Check if target is connected (best-effort: socket room members)
    const targetRoom = `messaging-user-${body.targetUserId}`;
    const targetSockets = await this.server.in(targetRoom).fetchSockets();
    if (!targetSockets.length) {
      try {
        const { conversation } = await this.messagingService.getOrCreateGuidePilgrimConversation(
          session,
          body.targetUserId,
        );

        const normalizedConversation = Array.isArray(conversation) ? conversation[0] : conversation;
        if (!normalizedConversation?.id) {
          throw new Error('Conversation not found');
        }

        const message = await this.messagingService.createSystemMessage({
          conversationId: normalizedConversation.id,
          content: 'Appel manqué',
          messageType: MessageType.SYSTEM,
          metadata: {
            type: 'missed_call',
            callId: body.callId,
            fromUserId: session.userId,
            toUserId: body.targetUserId,
            createdAt: new Date().toISOString(),
          },
        });

        const payload = { conversation: normalizedConversation, message };
        this.emitMessageCreated(normalizedConversation.id, payload);
      } catch (e) {
        // ignore: call_unavailable is still returned
      }

      client.emit('call_unavailable', {
        callId: body.callId,
        targetUserId: body.targetUserId,
        reason: 'offline',
      });
      return;
    }

    this.activeCalls.set(body.callId, { callerUserId: session.userId, calleeUserId: body.targetUserId });

    this.server.to(`messaging-user-${body.targetUserId}`).emit('call_offer', {
      callId: body.callId,
      fromUserId: session.userId,
      fromRole: session.activeRole,
      sdp: body.sdp,
      metadata: body.metadata || null,
    });
  }

  @SubscribeMessage('call_answer')
  async handleCallAnswer(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: CallSignalPayload,
  ) {
    const session = this.connectedClients.get(client.id);
    if (!session || !body?.callId || !body?.targetUserId) {
      client.emit('call_error', { message: 'Invalid call answer' });
      return;
    }

    const call = this.activeCalls.get(body.callId);
    if (!call || call.callerUserId !== body.targetUserId || call.calleeUserId !== session.userId) {
      client.emit('call_error', { message: 'Invalid call answer (not a participant)' });
      return;
    }

    this.server.to(`messaging-user-${body.targetUserId}`).emit('call_answer', {
      callId: body.callId,
      fromUserId: session.userId,
      fromRole: session.activeRole,
      sdp: body.sdp,
      metadata: body.metadata || null,
    });
  }

  @SubscribeMessage('call_ice_candidate')
  async handleCallIceCandidate(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: CallSignalPayload,
  ) {
    const session = this.connectedClients.get(client.id);
    if (!session || !body?.callId || !body?.targetUserId || !body?.candidate) {
      client.emit('call_error', { message: 'Invalid ICE candidate' });
      return;
    }

    const call = this.activeCalls.get(body.callId);
    if (!call) {
      client.emit('call_error', { message: 'Unknown call' });
      return;
    }

    const isParticipant = session.userId === call.callerUserId || session.userId === call.calleeUserId;
    const isTargetParticipant = body.targetUserId === call.callerUserId || body.targetUserId === call.calleeUserId;
    if (!isParticipant || !isTargetParticipant) {
      client.emit('call_error', { message: 'Invalid ICE candidate (not a participant)' });
      return;
    }

    this.server.to(`messaging-user-${body.targetUserId}`).emit('call_ice_candidate', {
      callId: body.callId,
      fromUserId: session.userId,
      candidate: body.candidate,
    });
  }

  @SubscribeMessage('call_end')
  async handleCallEnd(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: CallSignalPayload,
  ) {
    const session = this.connectedClients.get(client.id);
    if (!session || !body?.callId || !body?.targetUserId) {
      client.emit('call_error', { message: 'Invalid call end' });
      return;
    }

    const call = this.activeCalls.get(body.callId);
    if (!call) {
      client.emit('call_error', { message: 'Unknown call' });
      return;
    }

    const isParticipant = session.userId === call.callerUserId || session.userId === call.calleeUserId;
    const isTargetParticipant = body.targetUserId === call.callerUserId || body.targetUserId === call.calleeUserId;
    if (!isParticipant || !isTargetParticipant) {
      client.emit('call_error', { message: 'Invalid call end (not a participant)' });
      return;
    }

    this.activeCalls.delete(body.callId);

    this.server.to(`messaging-user-${body.targetUserId}`).emit('call_end', {
      callId: body.callId,
      fromUserId: session.userId,
      metadata: body.metadata || null,
    });
  }

  emitPilgrimPositionUpdated(targetGuideUserId: string, payload: any) {
    if (!targetGuideUserId) return;
    this.server.to(`messaging-user-${targetGuideUserId}`).emit('pilgrim_position_updated', payload);
  }

  handleDisconnect(client: Socket) {
    this.connectedClients.delete(client.id);
  }

  @SubscribeMessage('join_conversation')
  async handleJoinConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { conversationId?: string },
  ) {
    const session = this.connectedClients.get(client.id);
    if (!session || !body?.conversationId) {
      client.emit('conversation_error', { message: 'Invalid conversation join request' });
      return;
    }

    try {
      await this.messagingService.getConversationForUser(session, body.conversationId);
      client.join(`conversation-${body.conversationId}`);
      client.emit('conversation_joined', { conversationId: body.conversationId });
    } catch (error) {
      client.emit('conversation_error', { message: error.message });
    }
  }

  emitMessageCreated(conversationId: string, payload: any) {
    this.server.to(`conversation-${conversationId}`).emit('message_created', payload);

    if (payload?.conversation?.groupId) {
      // Best-effort: emit to each pilgrim user room for group conversations
      // (clients might not have joined conversation-<id> room yet)
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.messagingService
        .getGroupPilgrimUserIds(String(payload.conversation.groupId))
        .then((pilgrimUserIds) => {
          for (const pilgrimUserId of pilgrimUserIds) {
            this.server.to(`messaging-user-${pilgrimUserId}`).emit('message_created', payload);
          }
        })
        .catch(() => {
          // ignore
        });
    }

    if (payload?.conversation?.pilgrimUserId) {
      this.server.to(`messaging-user-${payload.conversation.pilgrimUserId}`).emit('message_created', payload);
    }
    if (payload?.conversation?.agencyId) {
      this.server.to(`messaging-user-${payload.conversation.agencyId}`).emit('message_created', payload);
    }
    if (payload?.conversation?.guideId) {
      this.server.to(`messaging-user-${payload.conversation.guideId}`).emit('message_created', payload);
    }
    if (payload?.conversation?.supportAdminId) {
      this.server.to(`messaging-user-${payload.conversation.supportAdminId}`).emit('message_created', payload);
    }
  }

  emitReservationUpdated(conversationId: string, payload: any) {
    this.server.to(`conversation-${conversationId}`).emit('reservation_updated', payload);
    if (payload?.conversation?.pilgrimUserId) {
      this.server
        .to(`messaging-user-${payload.conversation.pilgrimUserId}`)
        .emit('reservation_updated', payload);
    }
    if (payload?.conversation?.agencyId) {
      this.server.to(`messaging-user-${payload.conversation.agencyId}`).emit('reservation_updated', payload);
    }
    if (payload?.conversation?.guideId) {
      this.server.to(`messaging-user-${payload.conversation.guideId}`).emit('reservation_updated', payload);
    }
    if (payload?.conversation?.supportAdminId) {
      this.server.to(`messaging-user-${payload.conversation.supportAdminId}`).emit('reservation_updated', payload);
    }
  }

  emitReservationCreated(targetUserId: string, payload: any) {
    this.server.to(`messaging-user-${targetUserId}`).emit('reservation_created', payload);
  }

  emitConversationArchived(payload: any) {
    const conversation = payload?.conversation;
    if (!conversation) return;
    if (conversation.pilgrimUserId) {
      this.server.to(`messaging-user-${conversation.pilgrimUserId}`).emit('conversation_archived', payload);
    }
    if (conversation.agencyId) {
      this.server.to(`messaging-user-${conversation.agencyId}`).emit('conversation_archived', payload);
    }
    if (conversation.guideId) {
      this.server.to(`messaging-user-${conversation.guideId}`).emit('conversation_archived', payload);
    }
    if (conversation.supportAdminId) {
      this.server.to(`messaging-user-${conversation.supportAdminId}`).emit('conversation_archived', payload);
    }
  }

  emitConversationUnarchived(payload: any) {
    const conversation = payload?.conversation;
    if (!conversation) return;
    if (conversation.pilgrimUserId) {
      this.server.to(`messaging-user-${conversation.pilgrimUserId}`).emit('conversation_unarchived', payload);
    }
    if (conversation.agencyId) {
      this.server.to(`messaging-user-${conversation.agencyId}`).emit('conversation_unarchived', payload);
    }
    if (conversation.guideId) {
      this.server.to(`messaging-user-${conversation.guideId}`).emit('conversation_unarchived', payload);
    }
    if (conversation.supportAdminId) {
      this.server.to(`messaging-user-${conversation.supportAdminId}`).emit('conversation_unarchived', payload);
    }
  }

  emitConversationDeleted(payload: any) {
    const conversation = payload?.conversation;
    if (!conversation) return;
    if (conversation.pilgrimUserId) {
      this.server.to(`messaging-user-${conversation.pilgrimUserId}`).emit('conversation_deleted', payload);
    }
    if (conversation.agencyId) {
      this.server.to(`messaging-user-${conversation.agencyId}`).emit('conversation_deleted', payload);
    }
    if (conversation.guideId) {
      this.server.to(`messaging-user-${conversation.guideId}`).emit('conversation_deleted', payload);
    }
    if (conversation.supportAdminId) {
      this.server.to(`messaging-user-${conversation.supportAdminId}`).emit('conversation_deleted', payload);
    }
  }
}
