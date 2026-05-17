import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppNotification } from './entities/app-notification.entity';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationsEventsListener } from './notifications-events.listener';

@Module({
  imports: [TypeOrmModule.forFeature([AppNotification])],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsEventsListener],
  exports: [NotificationsService],
})
export class NotificationsModule {}
