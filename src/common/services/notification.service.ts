import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { NotificationsGateway } from '../gateways/notifications.gateway';
import { EventEmitter2 } from '@nestjs/event-emitter';

export type NotificationEventType =
  | 'contract_expired'
  | 'reservation'
  | 'chat'
  | 'profile_incomplete'
  | 'kyc'
  | 'sos'
  | 'sos_alert'
  | 'generic';

export interface AppNotificationPayload {
  title: string;
  body: string;
  data?: Record<string, any> & { type?: NotificationEventType };
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly notificationsGateway: NotificationsGateway,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async sendToUser(params: {
    userId: string;
    expoPushToken?: string | null;
    payload: AppNotificationPayload;
    channels?: {
      socket?: boolean;
      push?: boolean;
    };
  }) {
    const channels = {
      socket: params.channels?.socket !== false,
      push: params.channels?.push === true,
    };

    if (channels.socket) {
      this.notificationsGateway.sendNotification(params.userId, {
        title: params.payload.title,
        body: params.payload.body,
        data: params.payload.data,
      }, { persist: false });
    }

    this.eventEmitter.emit('app_notification.created', {
      userId: params.userId,
      title: params.payload.title,
      body: params.payload.body,
      data: params.payload.data || null,
    });

    if (channels.push) {
      const token = String(params.expoPushToken || '').trim();
      if (!token) return;

      // basic validation
      if (!token.startsWith('ExponentPushToken') && !token.startsWith('ExpoPushToken')) {
        this.logger.warn(
          JSON.stringify({
            msg: 'invalid_expo_push_token',
            userId: params.userId,
            tokenPrefix: token.slice(0, 18),
          }),
        );
        return;
      }

      try {
        await axios.post(
          'https://exp.host/--/api/v2/push/send',
          {
            to: token,
            title: params.payload.title,
            body: params.payload.body,
            data: params.payload.data || {},
            sound: 'default',
            priority: 'high',
          },
          {
            timeout: 15000,
            headers: {
              'Content-Type': 'application/json',
            },
          },
        );
      } catch (e: any) {
        this.logger.error(
          JSON.stringify({
            msg: 'expo_push_send_error',
            userId: params.userId,
            error: String(e?.message || e),
          }),
        );
      }
    }
  }
}
