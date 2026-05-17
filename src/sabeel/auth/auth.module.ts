import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MailerModule } from '@nestjs-modules/mailer';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/dist/adapters/handlebars.adapter';
import { User } from './entities/user.entity';
import { AgencyGroup } from '../../admin_agence/group/entities/group.entity';
import { AgencyGuide } from '../../admin_agence/guide/entities/guide.entity';
import { AdminAgenceUser } from '../../admin_agence/auth/entities/admin-agence-user.entity';
import { Reservation } from '../reservation/entities/reservation.entity';
import { AuthService } from './services/auth.service';
import { SessionStorageService } from './services/session-storage.service';
import { EmailService } from './services/email.service';
import { AuthController } from './controller/auth.controller';
import { SanitizeMiddleware } from '../../common/middleware/sanitize.middleware';
import { join } from 'path';
import { PackUmrah } from '../../admin_agence/pack_umrah/entities/pack-umrah.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, AgencyGroup, AgencyGuide, AdminAgenceUser, Reservation, PackUmrah]),
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
          from: `"${configService.get<string>('MAIL_FROM_NAME') || 'Sabeel'}" <${configService.get<string>('MAIL_FROM') || 'noreply@sabeel.com'}>`,
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
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionStorageService,
    EmailService,
  ],
  exports: [AuthService, SessionStorageService, EmailService],
})

export class SabeelAuthModule {
  configure(consumer: any) {
    consumer
      .apply(SanitizeMiddleware)
      .forRoutes('*');
  }
}


