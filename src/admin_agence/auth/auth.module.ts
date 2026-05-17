import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MailerModule } from '@nestjs-modules/mailer';
import { CommonModule } from '../../common/common.module';
import { SanitizeMiddleware } from '../../common/middleware/sanitize.middleware';
import { AdminAgenceAuthController } from './auth.controller';
import { AdminAgenceAuthService } from './auth.service';
import { AdminAgenceUser } from './entities/admin-agence-user.entity';
import { AdminAgenceEmailService } from './services/email.service';
import { AgencyGuide } from '../guide/entities/guide.entity';
import { PackUmrah } from '../pack_umrah/entities/pack-umrah.entity';
import { PaymentsModule } from '../../payments/payments.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AdminAgenceUser, AgencyGuide, PackUmrah]),
    CommonModule,
    PaymentsModule,
    MailerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ({
        transport: {
          host: configService.get<string>('MAIL_HOST') || 'smtp.gmail.com',
          port: configService.get<number>('MAIL_PORT') || 587,
          secure: false,
          auth: {
            user: configService.get<string>('MAIL_USER'),
            pass: configService.get<string>('MAIL_PASS')?.replace(/\s+/g, ''),
          },
        },
        defaults: {
          from: `"${configService.get<string>('MAIL_FROM_NAME') || 'Sabeel'}" <${configService.get<string>('MAIL_FROM') || 'noreply@sabeel.com'}>`,
        },
      }),
    }),
  ],
  controllers: [AdminAgenceAuthController],
  providers: [AdminAgenceAuthService, AdminAgenceEmailService],
  exports: [AdminAgenceAuthService, AdminAgenceEmailService],
})
export class AdminAgenceAuthModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(SanitizeMiddleware).forRoutes('admin-agence/auth');
  }
}
