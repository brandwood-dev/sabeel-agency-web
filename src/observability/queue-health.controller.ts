import { Controller, Get } from '@nestjs/common';
import { QueueProvider } from '../queue/queue.provider';

@Controller('health')
export class QueueHealthController {
  constructor(private readonly queueProvider: QueueProvider) {}

  @Get('queues')
  async queues() {
    const main = this.queueProvider.domainSideEffectsQueue
      ? await this.queueProvider.domainSideEffectsQueue.getJobCounts(
          'waiting',
          'active',
          'completed',
          'failed',
          'delayed',
          'paused',
        )
      : null;

    const dlq = this.queueProvider.domainSideEffectsDlqQueue
      ? await this.queueProvider.domainSideEffectsDlqQueue.getJobCounts(
          'waiting',
          'active',
          'completed',
          'failed',
          'delayed',
          'paused',
        )
      : null;

    return {
      domainSideEffects: main,
      domainSideEffectsDlq: dlq,
    };
  }
}
