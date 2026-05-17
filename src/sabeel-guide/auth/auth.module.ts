import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MailerModule } from '@nestjs-modules/mailer';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/dist/adapters/handlebars.adapter';
import { Guide } from './entities/guide.entity';
import { AuthService } from './services/auth.service';
import { SessionStorageService } from './services/session-storage.service';
import { EmailService } from './services/email.service';
import { AuthController } from './controller/auth.controller';
import { SanitizeMiddleware } from '../../common/middleware/sanitize.middleware';
import { join } from 'path';
import { MinioModule } from '../../minio/minio.module';
import { AdminAgenceUser } from '../../admin_agence/auth/entities/admin-agence-user.entity';
import { AgencyGuide } from '../../admin_agence/guide/entities/guide.entity';
import { PaymentsModule } from '../../payments/payments.module';

import { PublicGuidesController } from './controller/public-guides.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Guide, AdminAgenceUser, AgencyGuide]),
    MinioModule,
    PaymentsModule,

    PassportModule,
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
            pass: configService.get<string>('MAIL_PASS')?.replace(/\s+/g, ''), // Remove spaces
          },
        },
        defaults: {
          from: `"${configService.get<string>('MAIL_FROM_NAME') || 'SabeelGuide'}" <${configService.get<string>('MAIL_FROM') || 'noreply@sabeelguide.com'}>`,
        },
        template: {
          dir: join(__dirname, 'templates'),
          adapter: new HandlebarsAdapter(),
          options: {
            strict: true,
          },
        },
      }),
    }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET') || 'default-secret',
        signOptions: {
          expiresIn: configService.get<string>('JWT_EXPIRES_IN') || '24h',
        } as any,
      }),
    }),
  ],
  controllers: [AuthController, PublicGuidesController],
  providers: [
    AuthService,
    SessionStorageService,
    EmailService,
  ],
  exports: [AuthService, SessionStorageService, EmailService],
})


export class AuthModule {
  configure(consumer: any) {
    consumer
      .apply(SanitizeMiddleware)
      .forRoutes('*');
  }
}
