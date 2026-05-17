import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { StripeWebhookEvent } from './entities/stripe-webhook-event.entity';

@Injectable()
export class StripeRetentionService {
  private readonly logger = new Logger(StripeRetentionService.name);

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(StripeWebhookEvent)
    private readonly eventRepository: Repository<StripeWebhookEvent>,
  ) {}

  private getRetentionMonths() {
    const raw = this.configService.get<string>('STRIPE_WEBHOOK_RETENTION_MONTHS', '12');
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) return 12;
    return Math.floor(value);
  }

  // Runs daily at 03:10
  @Cron('10 3 * * *')
  async applyRetentionPolicy() {
    const months = this.getRetentionMonths();
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);

    try {
      const count = await this.eventRepository.count({ where: { createdAt: LessThan(cutoff) } });
      if (!count) {
        this.logger.debug(JSON.stringify({ msg: 'stripe_retention_noop', cutoff: cutoff.toISOString(), months }));
        return;
      }

      await this.eventRepository.delete({ createdAt: LessThan(cutoff) } as any);

      this.logger.log(
        JSON.stringify({
          msg: 'stripe_retention_deleted',
          deleted: count,
          cutoff: cutoff.toISOString(),
          months,
        }),
      );
    } catch (e: any) {
      this.logger.error(
        JSON.stringify({
          msg: 'stripe_retention_error',
          error: String(e?.message || e),
          cutoff: cutoff.toISOString(),
          months,
        }),
      );
    }
  }
}
