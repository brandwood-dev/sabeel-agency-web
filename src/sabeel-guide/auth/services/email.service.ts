import { Injectable } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';

@Injectable()
export class EmailService {
  constructor(private mailerService: MailerService) {}

  async sendOtpEmail(email: string, otp: string): Promise<void> {
    try {
      await this.mailerService.sendMail({
        to: email,
        subject: 'SabeelGuide - Password Reset OTP',
        html: `
          <h2>Password Reset Request</h2>
          <p>Hello,</p>
          <p>You have requested to reset your password for SabeelGuide.</p>
          <p>Your OTP code is: <strong>${otp}</strong></p>
          <p>This code will expire in 15 minutes.</p>

          <p>If you didn't request this, please ignore this email.</p>
          <br>
          <p>Best regards,<br>SabeelGuide Team</p>
        `,
      });
      console.log(`OTP email sent successfully to ${email}`);
    } catch (error) {
      console.error('Failed to send OTP email:', error);
      // En cas d'erreur, on log l'OTP pour le développement
      console.log(`OTP for ${email}: ${otp}`);
    }
  }

  async sendWelcomeEmail(email: string, firstName: string): Promise<void> {
    try {
      await this.mailerService.sendMail({
        to: email,
        subject: 'Welcome to SabeelGuide!',
        template: './welcome',
        context: {
          email,
          firstName,
          appName: 'SabeelGuide',
        },
      });
    } catch (error) {
      console.error('Failed to send welcome email:', error);
    }
  }

  async sendContractExpiredEmail(payload: {
    email: string;
    guideName: string;
    expiresAt: Date;
  }): Promise<void> {
    try {
      await this.mailerService.sendMail({
        to: payload.email,
        subject: 'Sabeel - Votre contrat guide a expiré',
        html: `
          <h2>Contrat expiré</h2>
          <p>Bonjour ${payload.guideName || ''},</p>
          <p>Votre contrat de guide freelance a expiré le <strong>${payload.expiresAt.toLocaleDateString()}</strong>.</p>
          <p>Veuillez vous reconnecter sur l'application Sabeel Guide et re-signer le contrat pour continuer à profiter pleinement de l'expérience.</p>
          <br />
          <p>Cordialement,<br/>Équipe Sabeel</p>
        `,
      });
    } catch (error) {
      console.error('Failed to send contract expired email:', error);
    }
  }
}
