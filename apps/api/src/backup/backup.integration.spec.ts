import { BackupService } from './backup.service';
import { PrismaClient } from '@prisma/client';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { spawn } from 'child_process';
import { createHash } from 'crypto';
import { gzipSync } from 'zlib';

describe('Backup PostgreSQL integration', () => {
  let source: PrismaClient;
  let backupService: BackupService;
  let backupDir: string;
  let restoreDatabase: string;
  let auditService: { logUserAction: jest.Mock };
  const originalEnv = { ...process.env };

  const runCommand = (command: string, args: string[], env: NodeJS.ProcessEnv = process.env) =>
    new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
      child.once('error', reject);
      child.once('close', (code) => code === 0 ? resolve() : reject(new Error(`${command} failed: ${stderr}`)));
    });

  beforeAll(async () => {
    backupDir = await mkdtemp(`${tmpdir()}/clinic-backup-integration-`);
    restoreDatabase = `clinic_restore_${process.pid}`;
    process.env.BACKUP_DIR = backupDir;
    process.env.BACKUP_ENCRYPTION_REQUIRED = 'true';
    process.env.BACKUP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
    const databaseUrl = new URL(process.env.DATABASE_URL);
    process.env.DB_HOST = process.env.DB_HOST || databaseUrl.hostname;
    process.env.DB_PORT = process.env.DB_PORT || databaseUrl.port || '5432';
    process.env.POSTGRES_USER = 'clinic_test_user';
    process.env.POSTGRES_PASSWORD = 'clinic_test_password';
    process.env.POSTGRES_DB = 'clinic_test_db';

    source = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
    await source.$connect();
    await runCommand('createdb', ['--host', process.env.DB_HOST, '--port', process.env.DB_PORT, '--username', process.env.POSTGRES_USER, restoreDatabase], {
      ...process.env,
      PGPASSWORD: process.env.POSTGRES_PASSWORD,
    });
    auditService = { logUserAction: jest.fn() };
    backupService = new BackupService(auditService as any, source as any);
    backupService.onModuleInit();
  });

  afterAll(async () => {
    await source?.paymentAllocation.deleteMany({ where: { payment: { recordedBy: { email: { contains: 'backup.integration.' } } } } }).catch(() => undefined);
    await source?.payment.deleteMany({ where: { recordedBy: { email: { contains: 'backup.integration.' } } } }).catch(() => undefined);
    await source?.invoiceItem.deleteMany({ where: { invoice: { createdBy: { email: { contains: 'backup.integration.' } } } } }).catch(() => undefined);
    await source?.invoice.deleteMany({ where: { createdBy: { email: { contains: 'backup.integration.' } } } }).catch(() => undefined);
    await source?.visit.deleteMany({ where: { createdBy: { email: { contains: 'backup.integration.' } } } }).catch(() => undefined);
    await source?.service.deleteMany({ where: { createdBy: { email: { contains: 'backup.integration.' } } } }).catch(() => undefined);
    await source?.patient.deleteMany({ where: { createdBy: { email: { contains: 'backup.integration.' } } } }).catch(() => undefined);
    await source?.auditLog.deleteMany({ where: { user: { email: { contains: 'backup.integration.' } } } }).catch(() => undefined);
    await source?.user.deleteMany({ where: { email: { contains: 'backup.integration.' } } }).catch(() => undefined);
    await source?.$disconnect();
    await runCommand('dropdb', ['--if-exists', '--host', originalEnv.DB_HOST!, '--port', originalEnv.DB_PORT!, '--username', originalEnv.POSTGRES_USER!, restoreDatabase], {
      ...originalEnv,
      PGPASSWORD: originalEnv.POSTGRES_PASSWORD,
    }).catch(() => undefined);
    if (backupDir) await rm(backupDir, { recursive: true, force: true });
    process.env = { ...originalEnv };
  });

  it('creates an encrypted dump and restores clinic financial relationships with real clients', async () => {
    const suffix = `${Date.now()}-${process.pid}`;
    const user = await source.user.create({
      data: { email: `backup.integration.${suffix}@test.com`, passwordHash: 'integration', name: 'Backup Integration', role: 'ADMIN' },
    });
    const patient = await source.patient.create({
      data: { civilId: `backup-${suffix}`, fullNameAr: 'اختبار النسخ', fullNameEn: 'Backup Integration', phone: `555${String(Date.now()).slice(-7)}`, createdById: user.id },
    });
    const visit = await source.visit.create({ data: { patientId: patient.id, type: 'OTHER', createdById: user.id } });
    const service = await source.service.create({ data: { name: 'Backup Test Service', code: `B-${suffix}`, currentPrice: 25, createdById: user.id } });
    const invoice = await source.invoice.create({
      data: {
        invoiceNumber: `INV-BACKUP-${suffix}`,
        visitId: visit.id,
        patientId: patient.id,
        status: 'ISSUED',
        subtotal: 25,
        total: 25,
        paid: 25,
        remaining: 0,
        paymentStatus: 'PAID',
        issuedAt: new Date(),
        createdById: user.id,
        issuedById: user.id,
        invoiceItems: { create: { serviceId: service.id, serviceNameSnapshot: service.name, unitPriceSnapshot: 25, quantity: 1, lineTotal: 25 } },
      },
    });
    const payment = await source.payment.create({
      data: { invoiceId: invoice.id, amount: 25, method: 'KNET', recordedById: user.id },
    });
    await source.paymentAllocation.create({ data: { paymentId: payment.id, invoiceId: invoice.id, amount: 25 } });

    const result = await backupService.runBackup('manual', user.id);
    expect(result.filename).toMatch(/\.sql\.gz\.enc$/);
    expect((await backupService.listBackups()).some((entry) => entry.filename === result.filename && entry.encrypted)).toBe(true);

    process.env.POSTGRES_DB = restoreDatabase;
    process.env.DATABASE_URL = `postgresql://${process.env.POSTGRES_USER}:${process.env.POSTGRES_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${restoreDatabase}`;
    await backupService.restoreBackup(result.filename, user.id);

    const safetyBackup = (await backupService.listBackups()).find(entry => entry.triggeredBy === 'pre-restore-safety');
    expect(safetyBackup?.protected).toBe(true);
    expect(auditService.logUserAction).toHaveBeenCalledWith(
      user.id, 'RESTORE_EXECUTED', 'System', result.filename, undefined, undefined,
    );
    expect(auditService.logUserAction).toHaveBeenCalledWith(
      user.id, 'BACKUP_CREATED', 'System', safetyBackup?.filename, undefined, undefined,
    );

    const restored = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
    try {
      const restoredInvoice = await restored.invoice.findUnique({
        where: { invoiceNumber: invoice.invoiceNumber },
        include: { patient: true, visit: true, invoiceItems: true, payments: true, paymentAllocations: true },
      });
      expect(restoredInvoice?.patient.civilId).toBe(patient.civilId);
      expect(restoredInvoice?.visit.id).toBe(visit.id);
      expect(restoredInvoice?.invoiceItems).toHaveLength(1);
      expect(restoredInvoice?.payments).toHaveLength(1);
      expect(restoredInvoice?.paymentAllocations).toHaveLength(1);
      expect(Number(restoredInvoice?.total)).toBe(25);
      expect(Number(restoredInvoice?.paid)).toBe(25);
    } finally {
      await restored.$disconnect();
    }
  }, 120000);

  it('restores a historical compressed plain SQL dump after skipping managed-role-incompatible statements', async () => {
    const suffix = `${Date.now()}_${process.pid}`;
    const tableName = `backup_restore_compat_${suffix}`;
    const filename = `clinic_backup_historical-${suffix}.sql.gz`;
    const sql = [
      `CREATE TABLE public.${tableName} (id integer PRIMARY KEY, label text NOT NULL);`,
      `COPY public.${tableName} (id, label) FROM stdin;`,
      '1\tfixture row',
      '\\.',
      `ALTER TABLE public.${tableName} OWNER TO historical_owner;`,
      'ALTER DEFAULT PRIVILEGES FOR ROLE historical_owner IN SCHEMA public GRANT SELECT ON TABLES TO historical_reader;',
      `GRANT SELECT ON TABLE public.${tableName} TO historical_reader;`,
      `REVOKE ALL ON TABLE public.${tableName} FROM historical_owner;`,
      'SET statement_timeout = 0;',
    ].join('\n') + '\n';
    const content = gzipSync(Buffer.from(sql));
    await writeFile(`${backupDir}/${filename}`, content);
    const manifest = await backupService['readManifest']();
    manifest.entries.push({
      filename,
      sizeBytes: content.length,
      sha256: createHash('sha256').update(content).digest('hex'),
      createdAt: new Date().toISOString(),
      triggeredBy: 'manual',
      uploadedToRemote: false,
      validation: { gzipVerified: true, databaseVerified: false, verifiedAt: new Date().toISOString() },
      protected: false,
    });
    await backupService['writeManifest'](manifest);

    const restoreUrl = `postgresql://${process.env.POSTGRES_USER}:${process.env.POSTGRES_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${restoreDatabase}`;
    process.env.POSTGRES_DB = restoreDatabase;
    process.env.DATABASE_URL = restoreUrl;
    const skippedStatementsLog = jest.spyOn(backupService['logger'], 'warn');
    try {
      await backupService.restoreBackup(filename, 'historical-fixture-admin');

      expect(skippedStatementsLog).toHaveBeenCalledWith(
        'Restore skipped 4 unsupported ownership or ACL statement(s)',
      );
      expect(auditService.logUserAction).toHaveBeenCalledWith(
        'historical-fixture-admin', 'RESTORE_EXECUTED', 'System', filename, undefined, undefined,
      );

      const restored = new PrismaClient({ datasources: { db: { url: restoreUrl } } });
      try {
        const rows = await restored.$queryRawUnsafe<Array<{ id: number; label: string }>>(
          `SELECT id, label FROM public.${tableName}`,
        );
        expect(rows).toEqual([{ id: 1, label: 'fixture row' }]);
      } finally {
        await restored.$disconnect();
      }
    } finally {
      skippedStatementsLog.mockRestore();
    }
  }, 120000);
});
