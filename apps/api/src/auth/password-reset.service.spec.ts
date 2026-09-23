import { AuthService } from './auth.service';

describe('AuthService password reset delivery failure', () => {
  it('invalidates the newly created reset token when Resend delivery fails', async () => {
    const resetToken = { id: 'reset-token-id' };
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-id',
          email: 'user@example.com',
          isActive: true,
        }),
      },
      passwordResetToken: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue(resetToken),
        update: jest.fn().mockResolvedValue(resetToken),
      },
    };
    const emailService = {
      sendPasswordResetEmail: jest.fn().mockRejectedValue(new Error('Resend unavailable')),
    };
    const auditService = { logUserAction: jest.fn().mockResolvedValue(undefined) };
    const service = new AuthService(
      prisma as never,
      {} as never,
      {} as never,
      auditService as never,
      emailService as never,
    );

    await expect(service.forgotPassword({ email: 'user@example.com' })).resolves.toEqual({
      message: 'If an account with this email exists, a verification code has been sent.',
    });
    expect(emailService.sendPasswordResetEmail).toHaveBeenCalledWith(
      'user@example.com',
      expect.stringMatching(/^\d{6}$/),
    );
    expect(prisma.passwordResetToken.update).toHaveBeenCalledWith({
      where: { id: resetToken.id },
      data: { usedAt: expect.any(Date) },
    });
  });
});
