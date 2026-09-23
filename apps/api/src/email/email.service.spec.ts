import { EmailService } from './email.service';
import { Resend } from 'resend';

jest.mock('resend', () => ({
  Resend: jest.fn(),
}));

describe('EmailService', () => {
  const ResendMock = Resend as jest.MockedClass<typeof Resend>;
  const configuredKey = 'configured-api-key';
  const config = (values: Record<string, string | undefined>) => ({
    get: jest.fn((key: string) => values[key]),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = 'test';
  });

  it('initializes Resend with complete configuration', () => {
    new EmailService(config({
      RESEND_API_KEY: configuredKey,
      RESEND_FROM: 'Clinic <noreply@example.com>',
    }) as never);

    expect(ResendMock).toHaveBeenCalledWith(configuredKey);
  });

  it('disables email delivery when Resend configuration is incomplete', () => {
    const service = new EmailService(config({
      RESEND_API_KEY: configuredKey,
      RESEND_FROM: '',
    }) as never);

    expect(service.isConfigured()).toBe(false);
    expect(ResendMock).not.toHaveBeenCalled();
  });

  it('sends the bilingual reset email through the Resend API', async () => {
    const send = jest.fn().mockResolvedValue({ data: { id: 'email-id' }, error: null });
    ResendMock.mockImplementation(() => ({ emails: { send } }) as never);
    const service = new EmailService(config({
      RESEND_API_KEY: configuredKey,
      RESEND_FROM: 'Clinic <noreply@example.com>',
    }) as never);

    await expect(service.sendPasswordResetEmail('user@example.com', '123456')).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      from: 'Clinic <noreply@example.com>',
      to: 'user@example.com',
      subject: expect.stringContaining('Password Reset'),
      html: expect.stringContaining('123456'),
    }));
  });

  it('propagates Resend API failures without logging secrets or email content', async () => {
    const send = jest.fn().mockResolvedValue({ data: null, error: { message: 'rate limited' } });
    ResendMock.mockImplementation(() => ({ emails: { send } }) as never);
    const service = new EmailService(config({
      RESEND_API_KEY: configuredKey,
      RESEND_FROM: 'Clinic <noreply@example.com>',
    }) as never);
    const loggerError = jest.spyOn((service as any).logger, 'error');

    await expect(service.sendPasswordResetEmail('user@example.com', '123456')).rejects.toThrow('rate limited');

    const logOutput = loggerError.mock.calls.flat().join(' ');
    expect(logOutput).not.toContain(configuredKey);
    expect(logOutput).not.toContain('123456');
    expect(logOutput).not.toContain('user@example.com');
    expect(logOutput).not.toContain('Password Reset');
  });
});
