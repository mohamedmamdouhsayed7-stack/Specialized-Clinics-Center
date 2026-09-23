import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor(private configService: ConfigService) {
    this.initializeTransporter();
  }

  private initializeTransporter() {
    const smtpHost = this.configService.get<string>('SMTP_HOST');
    const smtpPort = Number(this.configService.get<string>('SMTP_PORT'));
    const smtpUser = this.configService.get<string>('SMTP_USER');
    const smtpPassword = this.configService.get<string>('SMTP_PASSWORD');
    const smtpFrom = this.configService.get<string>('SMTP_FROM');

    if (!smtpHost || !Number.isInteger(smtpPort) || smtpPort <= 0 || !smtpUser || !smtpPassword || !smtpFrom) {
      this.logger.warn('SMTP configuration incomplete. Email service will be disabled.');
      return;
    }

    try {
      this.transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 15_000,
        auth: {
          user: smtpUser,
          pass: smtpPassword,
        },
      });

      this.logger.log('Email service initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize email service', error);
      this.transporter = null;
    }
  }

  async sendPasswordResetEmail(email: string, verificationCode: string): Promise<void> {
    if (!this.transporter) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('SMTP is not configured');
      }
      this.logger.warn('Email service not configured outside production. Password reset email was not sent.');
      return;
    }

    const smtpFrom = this.configService.get<string>('SMTP_FROM');

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
      await this.transporter.sendMail({
        from: smtpFrom,
        to: email,
        subject,
        html,
      });
      this.logger.log('Password reset verification email sent');
    } catch (error) {
      this.logger.error(
        `Failed to send password reset verification email via ${this.configService.get<string>('SMTP_HOST')}:${this.configService.get<string>('SMTP_PORT')}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  isConfigured(): boolean {
    return this.transporter !== null;
  }
}
