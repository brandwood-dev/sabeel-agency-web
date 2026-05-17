import {
    WebSocketGateway,
    WebSocketServer,
    OnGatewayConnection,
    OnGatewayDisconnect,
    SubscribeMessage,
    MessageBody,
    ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';

@WebSocketGateway({
    cors: {
        origin: true,
    },
    namespace: '/notifications',
})
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer()
    server: Server;

    private readonly logger = new Logger(NotificationsGateway.name);
    private connectedClients: Map<string, string> = new Map(); // socketId -> userId

    constructor(
        private jwtService: JwtService,
        private configService: ConfigService,
        private eventEmitter: EventEmitter2,
    ) { }

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

            const userId = payload.sub;
            this.connectedClients.set(client.id, userId);
            client.join(`user-${userId}`);

            this.logger.log(`Client connected: socket=${client.id}, userId=${userId}`);

            // Send any pending notification immediately on connect
            client.emit('connection_ack', { userId, message: 'Connected to notifications' });
        } catch (e) {
            this.logger.warn(`Unauthorized connection attempt: ${e.message}`);
            client.disconnect();
        }
    }

    handleDisconnect(client: Socket) {
        const userId = this.connectedClients.get(client.id);
        this.connectedClients.delete(client.id);
        this.logger.log(`Client disconnected: socket=${client.id}, userId=${userId}`);
    }

    /**
     * Send a general notification to a specific user via Socket.io.
     */
    sendNotification(
        userId: string,
        payload: { title: string; body: string; data?: any },
        options?: { persist?: boolean },
    ) {
        this.server.to(`user-${userId}`).emit('new_notification', {
            ...payload,
            timestamp: new Date().toISOString(),
        });

        const persist = options?.persist !== false;
        if (persist) {
            this.eventEmitter.emit('app_notification.created', {
                userId,
                title: payload.title,
                body: payload.body,
                data: payload.data || null,
            });
        }
        this.logger.debug(`Notification sent to user ${userId}: ${payload.title}`);
    }

    /**
     * Send a profile-completion reminder to a specific user.
     */
    sendProfileIncompleteNotification(userId: string) {
        const payload = {
            type: 'profile_incomplete',
            title: 'Complétez votre profil',
            message: 'Ajoutez vos informations personnelles pour débloquer toutes les fonctionnalités.',
            actionLabel: 'Compléter',
            action: 'navigate:profile/personal_info',
            timestamp: new Date().toISOString(),
        };

        this.server.to(`user-${userId}`).emit('profile_incomplete', payload);

        this.eventEmitter.emit('app_notification.created', {
            userId,
            title: payload.title,
            body: payload.message,
            data: { type: payload.type, action: payload.action, actionLabel: payload.actionLabel },
        });
        this.logger.debug(`Profile incomplete notification sent to user ${userId}`);
    }

    /**
     * Internal message so the server can trigger notifications via sockets
     */
    @SubscribeMessage('ping')
    handlePing(@ConnectedSocket() client: Socket) {
        client.emit('pong', { timestamp: new Date().toISOString() });
    }
}
