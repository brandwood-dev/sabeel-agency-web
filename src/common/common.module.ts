import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { NotificationsGateway } from './gateways/notifications.gateway';
import { NotificationService } from './services/notification.service';

@Global()
@Module({
    imports: [
        PassportModule.register({ defaultStrategy: 'jwt' }),
        JwtModule.registerAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: (configService: ConfigService) => ({
                secret: configService.get<string>('JWT_SECRET') || 'default-secret',
                signOptions: {
                    expiresIn: configService.get<string>('JWT_EXPIRES_IN') || '24h',
                } as any,

            }),
        }),
    ],
    providers: [JwtStrategy, JwtAuthGuard, RolesGuard, NotificationsGateway, NotificationService],
    exports: [PassportModule, JwtModule, JwtStrategy, JwtAuthGuard, RolesGuard, NotificationsGateway, NotificationService],
})
export class CommonModule { }

