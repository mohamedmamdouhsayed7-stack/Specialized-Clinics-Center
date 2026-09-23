import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private resend: Resend | null = null;
  private fromAddress: string | null = null;

  constructor(private configService: ConfigService) {
    this.initializeResend();
  }

  private initializeResend() {
    const apiKey = this.configService.get<string>('RESEND_API_KEY');
    const fromAddress = this.configService.get<string>('RESEND_FROM');

    if (!apiKey || !fromAddress) {
      this.logger.warn('Resend configuration incomplete. Email service will be disabled.');
      return;
    }

    try {
      this.resend = new Resend(apiKey);
      this.fromAddress = fromAddress;
      this.logger.log('Email service initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize email service');
      this.resend = null;
      this.fromAddress = null;
    }
  }

  async sendPasswordResetEmail(email: string, verificationCode: string): Promise<void> {
    if (!this.resend || !this.fromAddress) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('Resend is not configured');
      }
      this.logger.warn('Email service not configured outside production. Password reset email was not sent.');
      return;
    }

    const subject = 'Password Reset Verification Code | رمز التحقق لإعادة تعيين كلمة المرور';
    const html = `
      <h2>Specialized Clinics Center</h2>
      <h3>Password Reset Verification</h3>
      <p>Your verification code is:</p>
      <p style="font-size: 28px; font-weight: bold; letter-spacing: 8px;">${verificationCode}</p>
      <p>This code expires in 10 minutes and must not be shared.</p>
      <hr />
      <h3>مركز العيادات التخصصية</h3>
      <p>رمز التحقق لإعادة تعيين كلمة المرور هو:</p>
      <p style="font-size: 28px; font-weight: bold; letter-spacing: 8px;">${verificationCode}</p>
      <p>ينتهي هذا الرمز خلال 10 دقائق. يرجى عدم مشاركته مع أي شخص.</p>
    `;

    try {
      const { error } = await this.resend.emails.send({
        from: this.fromAddress,
        to: email,
        subject,
        html,
      });

      if (error) {
        throw new Error(error.message || 'Resend email delivery failed');
      }

      this.logger.log('Password reset verification email sent');
    } catch (error) {
      this.logger.error('Failed to send password reset verification email through Resend');
      throw error;
    }
  }

  isConfigured(): boolean {
    return this.resend !== null && this.fromAddress !== null;
  }
}
