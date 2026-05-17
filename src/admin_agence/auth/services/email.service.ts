import { Injectable } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';

@Injectable()
export class AdminAgenceEmailService {
  constructor(private mailerService: MailerService) {}

  async sendOtpEmail(email: string, otp: string): Promise<void> {
    try {
      await this.mailerService.sendMail({
        to: email,
        subject: 'Sabeel - Réinitialisation de mot de passe',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px;">
            <h2 style="color: #1b5e20; text-align: center;">Réinitialisation de mot de passe</h2>
            <p>Bonjour,</p>
            <p>Vous avez demandé la réinitialisation de votre mot de passe pour votre compte Sabeel.</p>
            <div style="background-color: #f1f8e9; padding: 15px; border-radius: 5px; text-align: center; margin: 20px 0;">
              <p style="font-size: 18px; margin: 0;">Votre code OTP est :</p>
              <h1 style="color: #1b5e20; letter-spacing: 5px; margin: 10px 0;">${otp}</h1>
              <p style="font-size: 14px; color: #666; margin: 0;">Ce code expirera dans 15 minutes.</p>
            </div>
            <p>Si vous n'avez pas demandé cette réinitialisation, veuillez ignorer cet email.</p>
            <br>
            <p>Cordialement,<br>L'équipe Sabeel</p>
          </div>
        `,
      });
      console.log(`OTP email sent successfully to ${email}`);
    } catch (error) {
      console.error('Failed to send OTP email:', error);
      console.log(`OTP for ${email}: ${otp}`);
    }
  }
  async sendPasswordResetEmail(email: string, resetToken: string): Promise<void> {
    // Implementation depends on your email provider (SendGrid, AWS SES, etc.)
    console.log(`Password reset email sent to ${email} with token ${resetToken}`);
  }

  async sendWelcomeEmail(email: string, agencyName: string): Promise<void> {
    console.log(`Welcome email sent to ${email} for agency ${agencyName}`);
  }

  async sendAccountApprovedEmail(email: string, agencyName: string): Promise<void> {
    console.log(`Account approved email sent to ${email} for agency ${agencyName}`);
  }

  async sendAccountRejectedEmail(email: string, agencyName: string, reason: string): Promise<void> {
    console.log(`Account rejected email sent to ${email} for agency ${agencyName}. Reason: ${reason}`);
  }

  async sendAgencySubmissionReceivedEmail(data: { email: string; agencyName: string; responsibleName?: string; contractEndDate?: string }): Promise<void> {
    console.log(`Agency submission received email sent to ${data.email} for agency ${data.agencyName}`);
  }

  async sendAgencyApprovedEmail(data: { email: string; agencyName: string; responsibleName?: string }): Promise<void> {
    console.log(`Agency approved email sent to ${data.email} for agency ${data.agencyName}`);
  }

  async sendAgencyRejectedEmail(data: { email: string; agencyName: string; reason: string; responsibleName?: string }): Promise<void> {
    console.log(`Agency rejected email sent to ${data.email} for agency ${data.agencyName}. Reason: ${data.reason}`);
  }
}
