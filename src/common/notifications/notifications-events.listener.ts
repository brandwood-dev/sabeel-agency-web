import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationsService } from './notifications.service';

export type AppNotificationCreatedEvent = {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, any> | null;
};

@Injectable()
export class NotificationsEventsListener {
  constructor(private readonly notificationsService: NotificationsService) {}

  @OnEvent('app_notification.created', { async: true })
  async handleCreated(event: AppNotificationCreatedEvent) {
    await this.notificationsService.create({
      userId: event.userId,
      title: event.title,
      body: event.body,
      data: event.data || null,
    });
  }
}
