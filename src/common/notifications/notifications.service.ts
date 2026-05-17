import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppNotification } from './entities/app-notification.entity';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(AppNotification)
    private readonly repo: Repository<AppNotification>,
  ) {}

  async create(params: {
    userId: string;
    title: string;
    body: string;
    data?: Record<string, any> | null;
  }) {
    const n = this.repo.create({
      userId: params.userId,
      title: params.title,
      body: params.body,
      data: params.data || null,
    });
    return this.repo.save(n);
  }

  async listForUser(params: { userId: string; limit?: number; offset?: number }) {
    const limit = Math.min(Math.max(Number(params.limit || 30), 1), 100);
    const offset = Math.max(Number(params.offset || 0), 0);

    const [items, total] = await this.repo.findAndCount({
      where: { userId: params.userId },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    return {
      items,
      total,
      limit,
      offset,
    };
  }

  async markRead(params: { userId: string; notificationId: string }) {
    await this.repo.update(
      { id: params.notificationId, userId: params.userId },
      { readAt: new Date() },
    );
    return { success: true };
  }

  async markAllRead(params: { userId: string }) {
    await this.repo
      .createQueryBuilder()
      .update(AppNotification)
      .set({ readAt: () => 'NOW()' })
      .where('"userId" = :userId', { userId: params.userId })
      .andWhere('"readAt" IS NULL')
      .execute();

    return { success: true };
  }

  async clearAll(params: { userId: string }) {
    await this.repo.delete({ userId: params.userId });
    return { success: true };
  }
}
