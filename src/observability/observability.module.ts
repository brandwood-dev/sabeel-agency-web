import { Global, Module } from '@nestjs/common';
import { ObservabilityService } from './observability.service';
import { MetricsController } from './metrics.controller';
import { QueueHealthController } from './queue-health.controller';

@Global()
@Module({
  providers: [ObservabilityService],
  controllers: [MetricsController, QueueHealthController],
  exports: [ObservabilityService],
})
export class ObservabilityModule {}
