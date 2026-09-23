import { ConflictException, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';

describe('UsersService permanent deletion', () => {
  const auditService = { logUserAction: jest.fn() };
  const target = {
    id: 'target-id',
    email: 'target@example.com',
    name: 'Target',
    role: 'RECEPTIONIST',
    isActive: true,
  };

  function setup() {
    const tx = {
      user: {
        findUnique: jest.fn().mockResolvedValue(target),
        count: jest.fn(),
        delete: jest.fn(),
      },
      auditLog: { create: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
    };
    return { service: new UsersService(prisma as never, auditService as never), tx };
  }

  beforeEach(() => jest.clearAllMocks());

  it('deletes a target user and preserves a safe audit record', async () => {
    const { service, tx } = setup();
    tx.user.count.mockResolvedValue(2);

    await expect(service.remove('target-id', 'admin-id')).resolves.toEqual({ message: 'User deleted successfully' });
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        userId: 'admin-id',
        action: 'USER_DELETED',
        entityId: 'target-id',
        beforeState: target,
      }),
    }));
    expect(tx.user.delete).toHaveBeenCalledWith({ where: { id: 'target-id' } });
  });

  it('rejects self deletion', async () => {
    const { service } = setup();
    await expect(service.remove('admin-id', 'admin-id')).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects deleting the last administrator', async () => {
    const { service, tx } = setup();
    tx.user.findUnique.mockResolvedValue({ ...target, role: 'ADMIN' });
    tx.user.count.mockResolvedValue(1);
    await expect(service.remove('target-id', 'admin-id')).rejects.toBeInstanceOf(ConflictException);
    expect(tx.user.delete).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('returns not found without creating an audit row', async () => {
    const { service, tx } = setup();
    tx.user.findUnique.mockResolvedValue(null);
    await expect(service.remove('missing-id', 'admin-id')).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});
