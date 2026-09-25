import { AuditService } from './audit.service';

describe('AuditService', () => {
  it('stores UUID and technical identifiers as text entity IDs', async () => {
    const create = jest.fn().mockResolvedValue(undefined);
    const service = new AuditService({ auditLog: { create } } as never);

    await service.logUserAction('user-id', 'DATA_EXPORT', 'Report', 'reports-excel-export');
    await service.logUserAction(
      'user-id',
      'BACKUP_CREATED',
      'System',
      'clinic_backup_2026-09-23T05-40-00-000Z.sql.gz',
    );
    await service.logUserAction(
      'user-id',
      'USER_UPDATED',
      'User',
      '123e4567-e89b-12d3-a456-426614174000',
    );

    expect(create.mock.calls.map(([input]) => input.data.entityId)).toEqual([
      'reports-excel-export',
      'clinic_backup_2026-09-23T05-40-00-000Z.sql.gz',
      '123e4567-e89b-12d3-a456-426614174000',
    ]);
  });
});
