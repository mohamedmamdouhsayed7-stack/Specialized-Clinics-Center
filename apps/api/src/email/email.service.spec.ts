import { EmailService } from './email.service';
import * as nodemailer from 'nodemailer';

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(),
}));

describe('EmailService', () => {
  const createTransport = nodemailer.createTransport as jest.Mock;
  const config = (values: Record<string, string | undefined>) => ({
    get: jest.fn((key: string) => values[key]),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = 'test';
  });

  it('configures SMTP with bounded connection, greeting, and socket timeouts', () => {
    createTransport.mockReturnValue({ sendMail: jest.fn() });
    new EmailService(config({
      SMTP_HOST: 'smtp.gmail.com',
      SMTP_PORT: '587',
      SMTP_USER: 'mailbox@example.com',
      SMTP_PASSWORD: 'app-password',
      SMTP_FROM: 'mailbox@example.com',
    }) as never);

    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({
      host: 'smtp.gmail.com',
      port: 587,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    }));
  });

  it('disables SMTP when configuration is incomplete', () => {
    const service = new EmailService(config({
      SMTP_HOST: 'smtp.gmail.com',
      SMTP_PORT: '587',
      SMTP_USER: '',
      SMTP_PASSWORD: '',
      SMTP_FROM: '',
    }) as never);

    expect(service.isConfigured()).toBe(false);
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('propagates sendMail failures without logging sensitive values', async () => {
    const sendMail = jest.fn().mockRejectedValue(new Error('ETIMEDOUT'));
    createTransport.mockReturnValue({ sendMail });
    const service = new EmailService(config({
      SMTP_HOST: 'smtp.gmail.com',
      SMTP_PORT: '587',
      SMTP_USER: 'mailbox@example.com',
      SMTP_PASSWORD: 'app-password',
      SMTP_FROM: 'mailbox@example.com',
    }) as never);

    await expect(service.sendPasswordResetEmail('user@example.com', '123456')).rejects.toThrow('ETIMEDOUT');
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'user@example.com',
      from: 'mailbox@example.com',
    }));
  });
});
