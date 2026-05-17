import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

export interface SignupSessionData {
  email: string;
  phoneNumber: string;
  password?: string;
  firstName?: string;
  lastName?: string;
  role?: string;
  hasAcceptedTerms?: boolean;
  hasAcceptedPrivacyPolicy?: boolean;
  dateOfBirth?: string;
  gender?: string;
  nationality?: string;
  country?: string;
  city?: string;
  address?: string;
  cinOrPassport?: string;
  photo?: string;
  qrId?: string;
  step: number;
  timestamp: number;
}

@Injectable()
export class SessionStorageService {
  private sessions = new Map<string, SignupSessionData>();
  private otpStorage = new Map<string, { otp: string; timestamp: number }>();
  private readonly SESSION_TTL = 2 * 60 * 60 * 1000; // 2 heures
  private readonly OTP_TTL = 5 * 60 * 1000; // 5 minutes
  private readonly CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes

  constructor(private jwtService: JwtService) {
    // Nettoyer les sessions expirées toutes les 5 minutes
    setInterval(() => this.cleanup(), this.CLEANUP_INTERVAL);
  }

  setSession(email: string, data: SignupSessionData): void {
    this.sessions.set(email, data);
  }

  getSession<T = SignupSessionData>(email: string): T | null {
    const session = this.sessions.get(email);
    if (!session) return null;

    // Vérifier si la session n'est pas expirée
    if (Date.now() - session.timestamp > this.SESSION_TTL) {
      this.sessions.delete(email);
      return null;
    }

    return session as T;
  }

  deleteSession(email: string): void {
    this.sessions.delete(email);
  }

  generateSignupToken(email: string, step: number): string {
    return this.jwtService.sign(
      { email, step, type: 'signup' },
      { expiresIn: '2h' }
    );
  }

  validateSignupToken(token: string): { valid: boolean; email?: string; step?: number } {
    try {
      const decoded = this.jwtService.verify(token);
      if (decoded.type !== 'signup') {
        return { valid: false };
      }

      const session = this.getSession(decoded.email);
      if (!session || session.step !== decoded.step) {
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

  generateOtp(): string {
    return Math.floor(1000 + Math.random() * 9000).toString();
  }

  storeOtp(email: string, otp: string): void {
    this.otpStorage.set(email, {
      otp,
      timestamp: Date.now(),
    });
  }

  verifyOtp(email: string, otp: string): boolean {
    const stored = this.otpStorage.get(email);
    if (!stored) return false;

    // Vérifier si l'OTP n'est pas expiré
    if (Date.now() - stored.timestamp > this.OTP_TTL) {
      this.otpStorage.delete(email);
      return false;
    }

    return stored.otp === otp;
  }

  clearOtp(email: string): void {
    this.otpStorage.delete(email);
  }

  private cleanup(): void {
    const now = Date.now();

    // Nettoyer les sessions expirées
    for (const [email, session] of this.sessions.entries()) {
      if (now - session.timestamp > this.SESSION_TTL) {
        this.sessions.delete(email);
      }
    }

    // Nettoyer les OTP expirés
    for (const [email, otp] of this.otpStorage.entries()) {
      if (now - otp.timestamp > this.OTP_TTL) {
        this.otpStorage.delete(email);
      }
    }
  }
}
