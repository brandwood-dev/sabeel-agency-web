import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DomainSideEffectsWorker } from './workers/domain-side-effects.worker';
import { QueueProvider } from './queue.provider';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [QueueProvider, DomainSideEffectsWorker],
  exports: [QueueProvider],
})
export class QueueModule {}
