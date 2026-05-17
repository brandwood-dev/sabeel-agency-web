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
import { SosService } from './sos.service';
import type { SosTriggerPayload } from './sos.service';

@WebSocketGateway({
  cors: { origin: true },
  namespace: '/sos',
})
export class SosGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(SosGateway.name);
  private readonly connectedClients = new Map<string, { userId: string; activeRole?: string }>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly sosService: SosService,
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
      client.join(`sos-user-${session.userId}`);
      client.emit('connection_ack', session);

      this.logger.log(`Client connected: socket=${client.id}, userId=${session.userId}`);
    } catch (e: any) {
      this.logger.warn(`Unauthorized SOS connection attempt: ${String(e?.message || e)}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const session = this.connectedClients.get(client.id);
    this.connectedClients.delete(client.id);
    this.logger.log(`Client disconnected: socket=${client.id}, userId=${session?.userId}`);
  }

  // Mobile emits: /sos + event "trigger" (aka /sos/trigger)
  @SubscribeMessage('trigger')
  async handleTrigger(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: SosTriggerPayload,
  ) {
    const session = this.connectedClients.get(client.id);
    if (!session) {
      client.emit('sos_error', { message: 'Unauthorized' });
      return;
    }

    if (!body || typeof body.latitude !== 'number' || typeof body.longitude !== 'number') {
      client.emit('sos_error', { message: 'Invalid coordinates' });
      return;
    }

    try {
      const res = await this.sosService.triggerSos({
        currentUser: session,
        payload: body,
      });
      client.emit('sos_ack', res);
    } catch (e: any) {
      client.emit('sos_error', { message: e?.message || 'Failed to trigger SOS' });
    }
  }
}
