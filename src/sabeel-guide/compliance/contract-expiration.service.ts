import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Guide } from '../auth/entities/guide.entity';
import { EmailService } from '../auth/services/email.service';
import { NotificationService } from '../../common/services/notification.service';

@Injectable()
export class ContractExpirationService {
  private readonly logger = new Logger(ContractExpirationService.name);

  constructor(
    @InjectRepository(Guide)
    private readonly guideRepository: Repository<Guide>,
    private readonly notificationService: NotificationService,
    private readonly emailService: EmailService,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async notifyExpiredContracts() {
    const now = new Date();

    try {
      const batchSize = 50;

      const expired = await this.guideRepository
        .createQueryBuilder('g')
        .where('g.freelanceContractExpiresAt IS NOT NULL')
        .andWhere('g.freelanceContractPdfKey IS NOT NULL')
        .andWhere('g.freelanceContractSignedAt IS NOT NULL')
        .andWhere('g.freelanceContractExpiresAt <= :now', { now })
        .andWhere('g.freelanceContractExpirationNotifiedAt IS NULL')
        .orderBy('g.freelanceContractExpiresAt', 'ASC')
        .limit(batchSize)
        .getMany();

      if (!expired.length) return;

      for (const guide of expired) {
        try {
          guide.freelanceContractExpirationNotifiedAt = now;
          await this.guideRepository.save(guide);

          const guideName = guide.firstName
            ? `${guide.firstName} ${guide.lastName || ''}`.trim()
            : guide.email;

          await this.notificationService.sendToUser({
            userId: guide.id,
            expoPushToken: guide.expoPushToken,
            payload: {
              title: 'Contrat expiré',
              body: 'Votre contrat de guide freelance a expiré. Veuillez le re-signer pour continuer.',
              data: {
                type: 'contract_expired',
                expiresAt: guide.freelanceContractExpiresAt,
              },
            },
            channels: {
              socket: true,
              push: true,
            },
          });

          // Professional email
          if (guide.email) {
            await this.emailService.sendContractExpiredEmail({
              email: guide.email,
              guideName,
              expiresAt: guide.freelanceContractExpiresAt || now,
            });
          }

          this.logger.log(
            JSON.stringify({
              msg: 'contract_expired_notified',
              guideId: guide.id,
              expiresAt: guide.freelanceContractExpiresAt?.toISOString?.() || null,
            }),
          );
        } catch (inner: any) {
          this.logger.error(
            JSON.stringify({
              msg: 'contract_expired_notify_error',
              guideId: guide.id,
              error: String(inner?.message || inner),
            }),
          );
        }
      }
    } catch (e: any) {
      this.logger.error(
        JSON.stringify({
          msg: 'contract_expiration_cron_error',
          error: String(e?.message || e),
        }),
      );
    }
  }
}
