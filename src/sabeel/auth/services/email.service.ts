import { Injectable } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';

@Injectable()
export class EmailService {
  constructor(private mailerService: MailerService) {}

  async sendOtpEmail(email: string, otp: string): Promise<void> {
    try {
      await this.mailerService.sendMail({
        to: email,
        subject: 'Sabeel - Password Reset OTP',
        html: `
          <h2>Password Reset Request</h2>
          <p>Hello,</p>
          <p>You have requested to reset your password for Sabeel.</p>
          <p>Your OTP code is: <strong>${otp}</strong></p>
          <p>This code will expire in 5 minutes.</p>
          <p>If you didn't request this, please ignore this email.</p>
          <br>
          <p>Best regards,<br>Sabeel Team</p>
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
        subject: 'Welcome to Sabeel!',
        html: `
          <h2>Welcome to Sabeel!</h2>
          <p>Hello ${firstName},</p>
          <p>Thank you for registering with Sabeel. Your account has been created successfully.</p>
          <p>Your unique identifier is: <strong>${email}</strong></p>
          <p>You can now complete your profile and start using our services.</p>
          <br>
          <p>Best regards,<br>Sabeel Team</p>
        `,
      });
      console.log(`Welcome email sent successfully to ${email}`);
    } catch (error) {
      console.error('Failed to send welcome email:', error);
    }
  }

  async sendSupportEmail(userEmail: string, userName: string, message: string): Promise<void> {
    try {
      await this.mailerService.sendMail({
        to: 'aouiti.ameni99@gmail.com',
        subject: `Sabeel Support - Nouveau message de ${userName}`,
        html: `
          <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: auto; border: 1px solid #ddd; padding: 20px; border-radius: 10px;">
            <h2 style="color: #2C5F2D; border-bottom: 2px solid #2C5F2D; padding-bottom: 10px;">Nouveau message d'assistance Sabeel</h2>
            <p>Un utilisateur a envoyé une demande via l'application Sabeel.</p>
            <div style="background-color: #f9f9f9; padding: 15px; border-radius: 8px; margin: 20px 0;">
              <p><strong>De :</strong> ${userName}</p>
              <p><strong>Email :</strong> ${userEmail}</p>
              <p><strong>Message :</strong></p>
              <p style="white-space: pre-wrap; background-color: #fff; padding: 10px; border-left: 4px solid #2C5F2D;">${message}</p>
            </div>
            <p style="font-size: 12px; color: #777; margin-top: 30px;">
              Ce message a été généré automatiquement par le système d'assistance de Sabeel.
            </p>
          </div>
        `,
      });
      console.log(`Support email sent successfully for ${userEmail}`);
    } catch (error) {
      console.error('Failed to send support email:', error);
      throw error;
    }
  }
}
