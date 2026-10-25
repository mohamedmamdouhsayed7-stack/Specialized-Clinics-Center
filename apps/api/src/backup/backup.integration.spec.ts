import { BackupService } from './backup.service';
import { PrismaClient } from '@prisma/client';
import { mkdtemp, readdir as readDirectory, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { spawn } from 'child_process';
import { createHash } from 'crypto';
import { gzipSync } from 'zlib';
import * as path from 'path';

describe('Backup PostgreSQL integration', () => {
  let source: PrismaClient;
  let backupService: BackupService;
  let backupDir: string;
  let restoreDatabase: string;
  let auditService: { logUserAction: jest.Mock };
  let databaseHost: string;
  let databasePort: string;
  let databaseUser: string;
  let databasePassword: string;
  const originalEnv = { ...process.env };

  const runCommand = (command: string, args: string[], env: NodeJS.ProcessEnv = process.env) =>
    new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
      child.once('error', reject);
      child.once('close', (code) => code === 0 ? resolve() : reject(new Error(`${command} failed: ${stderr}`)));
    });

  async function migrationHistorySql(migrationNames?: string[]) {
    const migrationsDirectory = path.resolve(__dirname, '../../prisma/migrations');
    const directories = migrationNames || (await readDirectory(migrationsDirectory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && /^\d{14}_/.test(entry.name))
      .map((entry) => entry.name)
      .sort();
    const rows = directories.map((name, index) => {
      const id = `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
      return `${id}\t${'a'.repeat(64)}\t2026-10-25 00:00:00+00\t${name}\t\\N\t\\N\t2026-10-25 00:00:00+00\t1`;
    });
    return [
      'CREATE TABLE public."_prisma_migrations" ("id" VARCHAR(36) NOT NULL, "checksum" VARCHAR(64) NOT NULL, "finished_at" TIMESTAMPTZ, "migration_name" VARCHAR(255) NOT NULL, "logs" TEXT, "rolled_back_at" TIMESTAMPTZ, "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, "applied_steps_count" INTEGER NOT NULL DEFAULT 0, CONSTRAINT "_prisma_migrations_pkey" PRIMARY KEY ("id"));',
      'COPY public."_prisma_migrations" ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count") FROM stdin;',
      ...rows,
      '\\.',
    ].join('\n');
  }

  beforeAll(async () => {
    backupDir = await mkdtemp(`${tmpdir()}/clinic-backup-integration-`);
    restoreDatabase = `clinic_restore_${process.pid}`;
    process.env.BACKUP_DIR = backupDir;
    process.env.BACKUP_ENCRYPTION_REQUIRED = 'true';
    process.env.BACKUP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
    const databaseUrl = new URL(process.env.DATABASE_URL);
    databaseHost = process.env.DB_HOST || databaseUrl.hostname;
    databasePort = process.env.DB_PORT || databaseUrl.port || '5432';
    databaseUser = decodeURIComponent(databaseUrl.username);
    databasePassword = decodeURIComponent(databaseUrl.password);
    process.env.DB_HOST = databaseHost;
    process.env.DB_PORT = databasePort;
    process.env.POSTGRES_USER = databaseUser;
    process.env.POSTGRES_PASSWORD = databasePassword;
    process.env.POSTGRES_DB = databaseUrl.pathname.slice(1);

    source = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
    await source.$connect();
    await runCommand('createdb', ['--host', databaseHost, '--port', databasePort, '--username', databaseUser, restoreDatabase], {
      ...process.env,
      PGPASSWORD: databasePassword,
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
    await runCommand('dropdb', ['--if-exists', '--host', databaseHost, '--port', databasePort, '--username', databaseUser, restoreDatabase], {
      ...originalEnv,
      PGPASSWORD: databasePassword,
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
      'DROP TABLE IF EXISTS public."_prisma_migrations";',
      `CREATE TABLE public.${tableName} (id integer PRIMARY KEY, label text NOT NULL);`,
      `COPY public.${tableName} (id, label) FROM stdin;`,
      '1\tfixture row',
      '\\.',
      await migrationHistorySql(),
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

    const restoreDatabaseUrl = new URL(process.env.DATABASE_URL!);
    restoreDatabaseUrl.pathname = `/${restoreDatabase}`;
    const restoreUrl = restoreDatabaseUrl.toString();
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

  it('refuses an old-schema backup before it changes the target database', async () => {
    const suffix = `${Date.now()}_${process.pid}`;
    const tableName = `backup_restore_incompatible_${suffix}`;
    const filename = `clinic_backup_incompatible-${suffix}.sql.gz`;
    const migrationsDirectory = path.resolve(__dirname, '../../prisma/migrations');
    const allMigrations = (await readDirectory(migrationsDirectory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && /^\d{14}_/.test(entry.name))
      .map((entry) => entry.name)
      .sort();
    const oldMigrations = allMigrations.slice(0, -2);
    const sql = [
      `CREATE TABLE public.${tableName} (id integer PRIMARY KEY);`,
      await migrationHistorySql(oldMigrations),
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

    const targetUrl = new URL(process.env.DATABASE_URL!);
    targetUrl.pathname = `/${restoreDatabase}`;
    process.env.POSTGRES_DB = restoreDatabase;
    process.env.DATABASE_URL = targetUrl.toString();
    const safetyBackupCountBefore = (await backupService.listBackups())
      .filter((entry) => entry.triggeredBy === 'pre-restore-safety').length;

    await expect(backupService.restoreBackup(filename, 'old-backup-admin'))
      .rejects.toThrow(/Backup schema is older than this application/i);

    const target = new PrismaClient({ datasources: { db: { url: targetUrl.toString() } } });
    try {
      const table = await target.$queryRawUnsafe<Array<{ name: string | null }>>(
        `SELECT to_regclass('public.${tableName}')::text AS name`,
      );
      expect(table[0]?.name).toBeNull();
      expect((await backupService.listBackups())
        .filter((entry) => entry.triggeredBy === 'pre-restore-safety')).toHaveLength(safetyBackupCountBefore);
    } finally {
      await target.$disconnect();
    }
  }, 120000);
});
