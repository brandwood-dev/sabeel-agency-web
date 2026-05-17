import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SabeelGuideModule } from './sabeel-guide/sabeel-guide.module';
import { SabeelAuthModule } from './sabeel/auth/auth.module';
import { MinioModule } from './minio/minio.module';
import { SabeelAmadeusModule } from './sabeel/amadeus/amadeus.module';
import { CommonModule } from './common/common.module';
import { AdminAgenceModule } from './admin_agence/admin-agence.module';
import { AiModule } from './ai/ai.module';
import { MessagingModule } from './messaging/messaging.module';
import { ReservationModule } from './sabeel/reservation/reservation.module';
import { ReviewsModule } from './reviews/reviews.module';
import { TrackingModule } from './tracking/tracking.module';
import { WalletModule } from './wallet/wallet.module';
import { StripeModule } from './stripe/stripe.module';
import { PaymentsModule } from './payments/payments.module';
import { QueueModule } from './queue/queue.module';
import { ObservabilityModule } from './observability/observability.module';
import { NotificationsModule } from './common/notifications/notifications.module';
import { SosModule } from './sos/sos.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot({
      global: true,
      wildcard: false,
      delimiter: '.',
      maxListeners: 50,
    }),
    CommonModule,

    ThrottlerModule.forRoot([{
      ttl: 60000,
      limit: 10,
    }]),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get<string>('DB_HOST', 'localhost'),
        port: configService.get<number>('DB_PORT', 5432),
        username: configService.get<string>('DB_USER', 'postgres'),
        password: configService.get<string>('DB_PASSWORD', 'admin'),
        database: configService.get<string>('DB_NAME', 'sabeelDB'),
        autoLoadEntities: true,
        synchronize: true,
      }),
    }),
    MinioModule,
    SabeelGuideModule,
    SabeelAuthModule,
    SabeelAmadeusModule,
    AdminAgenceModule,
    MessagingModule,
    ReservationModule,
    ReviewsModule,
    AiModule,
    TrackingModule,
    WalletModule,
    StripeModule,
    PaymentsModule,
    QueueModule,
    ObservabilityModule,
    NotificationsModule,
    SosModule,
  ],




  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }

