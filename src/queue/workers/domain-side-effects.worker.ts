import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailerService } from '@nestjs-modules/mailer';
import { Worker, Job } from 'bullmq';
import { DataSource } from 'typeorm';
import { NotificationsGateway } from '../../common/gateways/notifications.gateway';
import { User } from '../../sabeel/auth/entities/user.entity';
import { Guide } from '../../sabeel-guide/auth/entities/guide.entity';
import { AdminAgenceUser } from '../../admin_agence/auth/entities/admin-agence-user.entity';
import { WithdrawalRequest } from '../../wallet/entities/withdrawal-request.entity';
import { Wallet } from '../../wallet/entities/wallet.entity';
import {
  DOMAIN_SIDE_EFFECTS_DLQ_JOB,
  DOMAIN_SIDE_EFFECTS_JOB,
  DOMAIN_SIDE_EFFECTS_QUEUE,
} from '../queue.constants';
import { QueueProvider } from '../queue.provider';
import { ObservabilityService } from '../../observability/observability.service';

@Injectable()
export class DomainSideEffectsWorker implements OnModuleInit {
  private readonly logger = new Logger(DomainSideEffectsWorker.name);
  private worker: Worker | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly queueProvider: QueueProvider,
    private readonly notificationsGateway: NotificationsGateway,
    private readonly mailerService: MailerService,
    private readonly dataSource: DataSource,
    private readonly observability: ObservabilityService,
  ) {}

  async onModuleInit() {
    const enabled = String(this.configService.get<string>('DOMAIN_SIDE_EFFECTS_WORKER_ENABLED', 'false')).toLowerCase();
    if (enabled !== 'true' && enabled !== '1') {
      this.logger.log('Domain side effects worker disabled (DOMAIN_SIDE_EFFECTS_WORKER_ENABLED=false)');
      return;
    }

    this.worker = new Worker(
      DOMAIN_SIDE_EFFECTS_QUEUE,
      async (job) => this.process(job),
      {
        connection: this.queueProvider.getConnection() as any,
        concurrency: Number(this.configService.get<string>('DOMAIN_SIDE_EFFECTS_WORKER_CONCURRENCY', '5')) || 5,
      },
    );

    this.worker.on('completed', (job) => {
      this.logger.log(JSON.stringify({ msg: 'side_effect_job_completed', jobId: job.id, name: job.name }));
    });

    this.worker.on('failed', (job, err) => {
      this.logger.error(
        JSON.stringify({
          msg: 'side_effect_job_failed',
          jobId: job?.id,
          name: job?.name,
          error: String(err?.message || err),
        }),
      );

      // Move to DLQ after retries exhausted
      try {
        const attempts = Number(job?.opts?.attempts || 1);
        const attemptsMade = Number(job?.attemptsMade || 0);
        if (attemptsMade >= attempts) {
          Promise.resolve()
            .then(async () => {
              await this.queueProvider.domainSideEffectsDlqQueue?.add(
                DOMAIN_SIDE_EFFECTS_DLQ_JOB.FAILED_SIDE_EFFECT,
                {
                  originalQueue: DOMAIN_SIDE_EFFECTS_QUEUE,
                  originalJobId: job?.id,
                  originalJobName: job?.name,
                  attempts,
                  attemptsMade,
                  failedReason: job?.failedReason || null,
                  stacktrace: (job as any)?.stacktrace || null,
                  error: String(err?.message || err),
                  data: job?.data || null,
                  movedAt: new Date().toISOString(),
                },
                {
                  jobId: job?.id ? `dlq:${String(job.id)}` : undefined,
                  removeOnComplete: { age: 60 * 60 * 24 * 30, count: 10000 },
                  removeOnFail: { age: 60 * 60 * 24 * 30, count: 10000 },
                },
              );

              this.logger.error(
                JSON.stringify({
                  msg: 'side_effect_job_moved_to_dlq',
                  jobId: job?.id,
                  name: job?.name,
                  attempts,
                  attemptsMade,
                }),
              );
            })
            .catch((e: any) => {
              this.logger.error(
                JSON.stringify({
                  msg: 'side_effect_job_dlq_move_failed',
                  jobId: job?.id,
                  name: job?.name,
                  error: String(e?.message || e),
                }),
              );
            });
        }
      } catch {
        // ignore
      }
    });

    this.logger.log('Domain side effects worker started');
  }

  private formatMoney(amountCents?: number | null, currency?: string | null) {
    const amount = typeof amountCents === 'number' ? amountCents : 0;
    const cur = String(currency || 'MAD').toUpperCase();
    return `${(amount / 100).toFixed(2)} ${cur}`;
  }

  private async getEmailForUserId(userId: string) {
    const u = await this.dataSource.getRepository(User).findOne({ where: { id: userId } as any });
    return u?.email ? String(u.email) : null;
  }

  private async getEmailForGuideId(guideId: string) {
    const g = await this.dataSource.getRepository(Guide).findOne({ where: { id: guideId } as any });
    return g?.email ? String(g.email) : null;
  }

  private async getEmailForAgencyId(agencyId: string) {
    const a = await this.dataSource.getRepository(AdminAgenceUser).findOne({ where: { id: agencyId } as any });
    return a?.email ? String(a.email) : null;
  }

  private notifyUser(userId: string, payload: { title: string; body: string; data?: any }) {
    this.notificationsGateway.sendNotification(userId, payload);
  }

  private async sendEmail(to: string, subject: string, html: string) {
    await this.mailerService.sendMail({ to, subject, html });
  }

  private async process(job: Job) {
    const startedAt = Date.now();
    let result: 'ok' | 'error' = 'ok';

    if (job.name !== DOMAIN_SIDE_EFFECTS_JOB.STRIPE_DOMAIN_EVENT) {
      return;
    }

    const payload: any = job.data?.payload || {};
    const eventName: string = String(payload?.eventName || '');
    const correlationId = payload?.correlationId ? String(payload.correlationId) : null;

    // NOTE: This worker intentionally does NOT mutate balances.

    try {
      if (eventName === 'wallet.topup.succeeded') {
        const pilgrimUserId = payload?.metadata?.pilgrimUserId ? String(payload.metadata.pilgrimUserId) : null;
        if (!pilgrimUserId) return;

        const amountText = this.formatMoney(payload.amount, payload.currency);
        this.notifyUser(pilgrimUserId, {
          title: 'Recharge réussie',
          body: `Votre wallet a été rechargé de ${amountText}.`,
          data: payload,
        });

        const email = await this.getEmailForUserId(pilgrimUserId);
        if (email) {
          await this.sendEmail(
            email,
            'Sabeel - Recharge de wallet confirmée',
            `<div style="font-family: Arial, sans-serif; line-height:1.6">
            <h2>Recharge confirmée</h2>
            <p>Votre recharge a été confirmée.</p>
            <p><strong>Montant :</strong> ${amountText}</p>
            <p><strong>Référence :</strong> ${String(payload.referenceId || '')}</p>
            <p>Merci,<br/>Équipe Sabeel</p>
          </div>`,
          );
        }

        return;
      }

      if (eventName === 'payment.direct.completed' || eventName === 'payment.wallet.completed') {
        const amountText = this.formatMoney(payload.amount, payload.currency);

        const payerUserId = payload?.metadata?.payerUserId ? String(payload.metadata.payerUserId) : null;
        const pilgrimUserId = payload?.metadata?.pilgrimUserId ? String(payload.metadata.pilgrimUserId) : null;
        const actorUserId = payerUserId || pilgrimUserId;

        if (actorUserId) {
          this.notifyUser(actorUserId, {
            title: 'Paiement confirmé',
            body: `Votre paiement de ${amountText} a été confirmé.`,
            data: payload,
          });

          const email = await this.getEmailForUserId(actorUserId);
          if (email) {
            await this.sendEmail(
              email,
              'Sabeel - Paiement confirmé',
              `<div style="font-family: Arial, sans-serif; line-height:1.6">
              <h2>Paiement confirmé</h2>
              <p>Votre paiement a été confirmé.</p>
              <p><strong>Montant :</strong> ${amountText}</p>
              <p><strong>Référence :</strong> ${String(payload.referenceId || '')}</p>
              <p>Merci,<br/>Équipe Sabeel</p>
            </div>`,
            );
          }
        }

        const recipientType = payload?.metadata?.recipientType ? String(payload.metadata.recipientType) : null;
        const recipientId = payload?.metadata?.recipientId ? String(payload.metadata.recipientId) : null;
        if (recipientType && recipientId) {
          const recipientEmail =
            recipientType === 'AGENCY'
              ? await this.getEmailForAgencyId(recipientId)
              : await this.getEmailForGuideId(recipientId);

          if (recipientEmail) {
            await this.sendEmail(
              recipientEmail,
              'Sabeel - Paiement reçu',
              `<div style="font-family: Arial, sans-serif; line-height:1.6">
              <h2>Paiement reçu</h2>
              <p>Vous avez reçu un paiement.</p>
              <p><strong>Montant :</strong> ${amountText}</p>
              <p><strong>Référence :</strong> ${String(payload.referenceId || '')}</p>
              <p>Merci,<br/>Équipe Sabeel</p>
            </div>`,
            );
          }
        }

        return;
      }

      if (eventName === 'refund.completed') {
        const payerUserId = payload?.metadata?.payerUserId ? String(payload.metadata.payerUserId) : null;
        if (!payerUserId) return;

        const amountText = this.formatMoney(payload.amount, payload.currency);
        this.notifyUser(payerUserId, {
          title: 'Remboursement effectué',
          body: `Un remboursement de ${amountText} a été effectué.`,
          data: payload,
        });

        const email = await this.getEmailForUserId(payerUserId);
        if (email) {
          await this.sendEmail(
            email,
            'Sabeel - Remboursement effectué',
            `<div style="font-family: Arial, sans-serif; line-height:1.6">
            <h2>Remboursement effectué</h2>
            <p>Un remboursement a été effectué.</p>
            <p><strong>Montant :</strong> ${amountText}</p>
            <p><strong>Référence :</strong> ${String(payload.referenceId || '')}</p>
            <p>Merci,<br/>Équipe Sabeel</p>
          </div>`,
          );
        }

        return;
      }

      if (eventName === 'withdrawal.paid' || eventName === 'withdrawal.failed') {
        const withdrawalRequestId = payload?.metadata?.withdrawalRequestId
          ? String(payload.metadata.withdrawalRequestId)
          : null;
        if (!withdrawalRequestId) return;

        const req = await this.dataSource
          .getRepository(WithdrawalRequest)
          .findOne({ where: { id: withdrawalRequestId } as any });
        if (!req) return;

        const wallet = await this.dataSource
          .getRepository(Wallet)
          .findOne({ where: { id: req.walletId } as any });
        if (!wallet) return;

        const ownerId = String(wallet.ownerId);
        const amountText = this.formatMoney(req.amount, req.currency);

        if (eventName === 'withdrawal.paid') {
          this.notifyUser(ownerId, {
            title: 'Retrait effectué',
            body: `Votre retrait de ${amountText} a été effectué.`,
            data: payload,
          });
        } else {
          this.notifyUser(ownerId, {
            title: 'Retrait échoué',
            body: `Votre retrait de ${amountText} a échoué. Les fonds ont été rétablis sur votre wallet.`,
            data: payload,
          });
        }

        const email =
          wallet.ownerType === 'AGENCY'
            ? await this.getEmailForAgencyId(ownerId)
            : await this.getEmailForGuideId(ownerId);

        if (email) {
          await this.sendEmail(
            email,
            eventName === 'withdrawal.paid' ? 'Sabeel - Retrait effectué' : 'Sabeel - Retrait échoué',
            `<div style="font-family: Arial, sans-serif; line-height:1.6">
            <h2>${eventName === 'withdrawal.paid' ? 'Retrait effectué' : 'Retrait échoué'}</h2>
            <p>${
              eventName === 'withdrawal.paid'
                ? 'Votre retrait a été effectué avec succès.'
                : 'Votre retrait a échoué. Les fonds ont été rétablis sur votre wallet.'
            }</p>
            <p><strong>Montant :</strong> ${amountText}</p>
            <p><strong>ID retrait :</strong> ${withdrawalRequestId}</p>
            <p>Merci,<br/>Équipe Sabeel</p>
          </div>`,
          );
        }

        return;
      }
    } catch (e) {
      result = 'error';
      this.logger.error(
        JSON.stringify({
          msg: 'side_effect_job_process_error',
          jobId: job.id,
          jobName: job.name,
          eventName,
          correlationId,
          error: String((e as any)?.message || e),
        }),
      );
      throw e;
    } finally {
      const durationMs = Date.now() - startedAt;
      try {
        this.observability.sideEffectJobsTotal.inc({
          job_name: String(job.name),
          event_name: String(eventName || 'unknown'),
          result,
        });
        this.observability.sideEffectJobDurationMs.observe(
          { job_name: String(job.name), event_name: String(eventName || 'unknown') },
          durationMs,
        );
      } catch {
        // ignore
      }

      this.logger.log(
        JSON.stringify({
          msg: 'side_effect_job_processed',
          jobId: job.id,
          jobName: job.name,
          eventName,
          correlationId,
          result,
          durationMs,
        }),
      );
    }
  }
}
