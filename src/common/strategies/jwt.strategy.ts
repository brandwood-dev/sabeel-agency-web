import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
    constructor(private configService: ConfigService) {
        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            ignoreExpiration: false,
            secretOrKey: configService.get<string>('JWT_SECRET') || 'default-secret',
        });
    }

    async validate(payload: any) {
        // This payload is what was signed during login
        if (!payload) {
            console.warn('[JwtStrategy] validate failed: empty payload');
            throw new UnauthorizedException();
        }
        console.log('[JwtStrategy] validate success', {
            sub: payload.sub,
            userId: payload.userId,
            email: payload.email,
            activeRole: payload.activeRole,
        });
        return {
            userId: payload.sub,
            email: payload.email,
            activeRole: payload.activeRole
        };
    }
}
