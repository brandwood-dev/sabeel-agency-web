import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

export interface SignupSessionData {
  email: string;
  phoneNumber: string;
  password: string;
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  gender?: string;
  nationality?: string;
  countryOfResidence?: string;
  fullAddress?: string;
  step: number;
  timestamp: number;
}

@Injectable()
export class SessionStorageService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SessionStorageService.name);
  private sessions = new Map<string, SignupSessionData>();
  private otpStorage = new Map<string, { otp: string; expiresAt: Date }>();
  private OTP_EXPIRY_MINUTES = 15;

  generateOtp(): string {
    // Generate a 6-digit random number
    return Math.floor(100000 + Math.random() * 900000).toString();
  }


  storeOtp(email: string, otp: string): void {
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + this.OTP_EXPIRY_MINUTES);
    
    this.otpStorage.set(email, { otp, expiresAt });
  }

  verifyOtp(email: string, otp: string): boolean {
    const storedData = this.otpStorage.get(email);
    
    if (!storedData) {
      return false;
    }
    
    if (new Date() > storedData.expiresAt) {
      this.otpStorage.delete(email);
      return false;
    }
    
    return storedData.otp === otp;
  }

  clearOtp(email: string): void {
    this.otpStorage.delete(email);
  }
  private readonly TTL = 2 * 60 * 60 * 1000; // 2 heures en millisecondes
  private readonly CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes en millisecondes
  private cleanupInterval: NodeJS.Timeout;

  constructor(private jwtService: JwtService) {}

  onModuleInit() {
    this.logger.log('Initializing session storage with 2-hour TTL and 5-minute cleanup');
    this.startCleanup();
  }

  onModuleDestroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }

  private startCleanup() {
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredSessions();
    }, this.CLEANUP_INTERVAL);
  }

  private cleanupExpiredSessions() {
    const now = Date.now();
    const expiredKeys: string[] = [];

    this.sessions.forEach((session, key) => {
      if (now - session.timestamp > this.TTL) {
        expiredKeys.push(key);
      }
    });

    if (expiredKeys.length > 0) {
      this.logger.log(`Cleaning up ${expiredKeys.length} expired sessions`);
      expiredKeys.forEach(key => this.sessions.delete(key));
    }
  }

  generateSignupToken(email: string, step: number): string {
    const payload = {
      email,
      step,
      type: 'signup',
      timestamp: Date.now(),
    };

    return this.jwtService.sign(payload, {
      expiresIn: '2h',
      secret: process.env.JWT_SECRET || 'default-secret',
    });
  }

  validateSignupToken(token: string): { valid: boolean; email?: string; step?: number } {
    try {
      const decoded = this.jwtService.verify(token, {
        secret: process.env.JWT_SECRET || 'default-secret',
      });

      if (decoded.type !== 'signup') {
        return { valid: false };
      }

      return {
        valid: true,
        email: decoded.email,
        step: decoded.step,
      };
    } catch (error) {
      return { valid: false };
    }
  }

  setSession(email: string, data: SignupSessionData): void {
    const sessionData = {
      ...data,
      timestamp: Date.now(),
    };
    this.sessions.set(email, sessionData);
    this.logger.debug(`Session stored for: ${email}, step: ${data.step}`);
  }

  getSession<T extends SignupSessionData>(email: string): T | null {
    const session = this.sessions.get(email);
    
    if (!session) {
      return null;
    }

    // Vérifier si la session a expiré
    const now = Date.now();
    if (now - session.timestamp > this.TTL) {
      this.sessions.delete(email);
      this.logger.debug(`Session expired and removed for: ${email}`);
      return null;
    }

    return session as T;
  }

  deleteSession(email: string): void {
    const deleted = this.sessions.delete(email);
    if (deleted) {
      this.logger.debug(`Session deleted for: ${email}`);
    }
  }

  sessionExists(email: string): boolean {
    const session = this.sessions.get(email);
    
    if (!session) {
      return false;
    }

    // Vérifier si la session a expiré
    const now = Date.now();
    if (now - session.timestamp > this.TTL) {
      this.sessions.delete(email);
      return false;
    }

    return true;
  }

  getActiveSessionCount(): number {
    const now = Date.now();
    let activeCount = 0;

    this.sessions.forEach(session => {
      if (now - session.timestamp <= this.TTL) {
        activeCount++;
      }
    });

    return activeCount;
  }

  getAllSessions(): Map<string, SignupSessionData> {
    const now = Date.now();
    const activeSessions = new Map<string, SignupSessionData>();

    this.sessions.forEach((session, key) => {
      if (now - session.timestamp <= this.TTL) {
        activeSessions.set(key, session);
      }
    });

    return activeSessions;
  }

  // Pour les tests et débogage
  forceCleanup(): void {
    this.cleanupExpiredSessions();
  }

  private notificationTimestamps = new Map<string, number>();
  private readonly NOTIFICATION_COOLDOWN = 60 * 60 * 1000; // 1 heure

  shouldSendNotification(userId: string): boolean {
    const lastSent = this.notificationTimestamps.get(userId);
    if (!lastSent) return true;
    return Date.now() - lastSent > this.NOTIFICATION_COOLDOWN;
  }

  setNotificationSent(userId: string): void {
    this.notificationTimestamps.set(userId, Date.now());
  }

  // Pour vérifier l'état du service
  getServiceStatus(): {
    totalSessions: number;
    activeSessions: number;
    ttl: number;
    cleanupInterval: number;
  } {
    return {
      totalSessions: this.sessions.size,
      activeSessions: this.getActiveSessionCount(),
      ttl: this.TTL,
      cleanupInterval: this.CLEANUP_INTERVAL,
    };
  }
}

