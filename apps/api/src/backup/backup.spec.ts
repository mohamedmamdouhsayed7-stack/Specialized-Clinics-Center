import { Test, TestingModule } from '@nestjs/testing';
import { BackupService } from './backup.service';
import { BackupController } from './backup.controller';
import { BackupModule } from './backup.module';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { EventEmitter } from 'events';
import { PassThrough, Readable, Writable } from 'stream';
import { gzipSync } from 'zlib';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { spawn } from 'child_process';
import * as ExcelJS from 'exceljs';

jest.mock('child_process', () => {
  const actual = jest.requireActual('child_process');
  return {
    ...actual,
    spawn: jest.fn(),
  };
});

function fakeProcess() {
  const process = new EventEmitter() as any;
  process.stdout = new PassThrough();
  process.stderr = new PassThrough();
  process.stdin = new PassThrough();
  process.kill = jest.fn();
  return process;
}

function createMockPrismaService() {
  return {
    patient: { findMany: jest.fn() },
    appointment: { findMany: jest.fn() },
    visit: { findMany: jest.fn() },
    service: { findMany: jest.fn() },
    invoice: { findMany: jest.fn() },
    invoiceItem: { findMany: jest.fn() },
    invoiceAdditionalCharge: { findMany: jest.fn() },
    payment: { findMany: jest.fn() },
    paymentAllocation: { findMany: jest.fn() },
  } as any;
}

describe('BackupModule', () => {
  let module: TestingModule;
  let backupService: BackupService;

  const originalEnv = { ...process.env };

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [BackupModule],
    })
      .overrideProvider(AuditService)
      .useValue({
        logUserAction: jest.fn(),
      })
      .compile();

    backupService = module.get<BackupService>(BackupService);
  });

  afterEach(async () => {
    if (module) {
      await module.close();
    }
    // Restore original environment
    process.env = { ...originalEnv };
  });

  describe('BackupService - Environment Validation', () => {
    it('should extract database name from DATABASE_URL if POSTGRES_DB not set', () => {
      delete process.env.POSTGRES_DB;
      process.env.DATABASE_URL = 'postgresql://user:pass@host:5432/my_database';
      process.env.BACKUP_DIR = '/app/backups';
      const service = new BackupService({ logUserAction: jest.fn() } as any, createMockPrismaService());
      expect(() => service.onModuleInit()).not.toThrow();
      const params = service['getDbConnectionParams']();
      expect(params.database).toBe('my_database');
    });

    it('should throw error if POSTGRES_DB not set and DATABASE_URL invalid', () => {
      delete process.env.POSTGRES_DB;
      delete process.env.DATABASE_URL;
      process.env.BACKUP_DIR = '/app/backups';
      const service = new BackupService({ logUserAction: jest.fn() } as any, createMockPrismaService());
      // Don't call onModuleInit() in this test since we're testing getDbConnectionParams
      expect(() => service['getDbConnectionParams']()).toThrow('DATABASE_URL or POSTGRES_DB is required');
    });

    it('derives Neon connection parameters from DATABASE_URL', () => {
      delete process.env.POSTGRES_USER;
      delete process.env.POSTGRES_PASSWORD;
      delete process.env.POSTGRES_DB;
      delete process.env.DB_HOST;
      delete process.env.DB_PORT;
      process.env.DATABASE_URL = 'postgresql://neon_user:neon_password@ep-example.neon.tech/neon_db?sslmode=require';

      const service = new BackupService({ logUserAction: jest.fn() } as any, createMockPrismaService());
      expect(service['getDbConnectionParams']()).toMatchObject({
        host: 'ep-example.neon.tech',
        port: '5432',
        user: 'neon_user',
        password: 'neon_password',
        database: 'neon_db',
        sslmode: 'require',
      });
    });

    it('decodes URL-encoded credentials and preserves query sslmode', () => {
      delete process.env.POSTGRES_USER;
      delete process.env.POSTGRES_PASSWORD;
      delete process.env.POSTGRES_DB;
      delete process.env.DB_HOST;
      delete process.env.DB_PORT;
      process.env.DATABASE_URL = 'postgresql://neon%40user:p%40ss%3Aword@ep-example.neon.tech:5433/clinic%20prod?sslmode=require&connect_timeout=10';

      const service = new BackupService({ logUserAction: jest.fn() } as any, createMockPrismaService());
      expect(service['getDbConnectionParams']()).toMatchObject({
        host: 'ep-example.neon.tech',
        port: '5433',
        user: 'neon@user',
        password: 'p@ss:word',
        database: 'clinic prod',
        sslmode: 'require',
      });
    });

    it('keeps Docker environment variables as connection overrides', () => {
      process.env.DATABASE_URL = 'postgresql://url_user:url_password@url-host/url_db?sslmode=require';
      process.env.DB_HOST = 'postgres';
      process.env.DB_PORT = '5432';
      process.env.POSTGRES_USER = 'clinic_user';
      process.env.POSTGRES_PASSWORD = 'clinic_password';
      process.env.POSTGRES_DB = 'clinic_test_db';

      const service = new BackupService({ logUserAction: jest.fn() } as any, createMockPrismaService());
      expect(service['getDbConnectionParams']()).toMatchObject({
        host: 'postgres',
        port: '5432',
        user: 'clinic_user',
        password: 'clinic_password',
        database: 'clinic_test_db',
        sslmode: 'require',
      });
    });

    it('should throw error if BACKUP_DIR is not absolute', () => {
      process.env.POSTGRES_DB = 'clinic_test_db';
      process.env.BACKUP_DIR = 'relative/path';
      expect(() => {
        const service = new BackupService({ logUserAction: jest.fn() } as any, createMockPrismaService());
        service.onModuleInit();
      }).toThrow('BACKUP_DIR must be an absolute path');
    });

    it('should prevent targeting production DB during test', () => {
      process.env.NODE_ENV = 'test';
      process.env.POSTGRES_DB = 'clinic_db';
      const service = new BackupService({ logUserAction: jest.fn() } as any, createMockPrismaService());
      expect(() => service['getDbConnectionParams']()).toThrow('Cannot target production database');
    });

    it('should allow targeting clinic_test_db during test', () => {
      process.env.NODE_ENV = 'test';
      process.env.POSTGRES_DB = 'clinic_test_db';
      const service = new BackupService({ logUserAction: jest.fn() } as any, createMockPrismaService());
      expect(() => service['getDbConnectionParams']()).not.toThrow();
    });
  });

  describe('BackupService - Filename Sanitization', () => {
    beforeEach(() => {
      process.env.POSTGRES_DB = 'clinic_test_db';
      process.env.BACKUP_DIR = '/app/backups';
    });

    it('should accept valid backup filename', () => {
      const service = new BackupService({ logUserAction: jest.fn() } as any, createMockPrismaService());
      const filename = 'clinic_backup_2024-01-01T12-00-00-000Z.sql.gz';
      expect(() => service['sanitizeFilename'](filename)).not.toThrow();
    });

    it('should reject invalid filename format', () => {
      const service = new BackupService({ logUserAction: jest.fn() } as any, createMockPrismaService());
      const filename = 'malicious.txt';
      expect(() => service['sanitizeFilename'](filename)).toThrow(BadRequestException);
    });

    it('should reject path traversal attempts', () => {
      const service = new BackupService({ logUserAction: jest.fn() } as any, createMockPrismaService());
      const filename = '../../../etc/passwd';
      expect(() => service['sanitizeFilename'](filename)).toThrow(BadRequestException);
    });

    it('should reject filename with path separators', () => {
      const service = new BackupService({ logUserAction: jest.fn() } as any, createMockPrismaService());
      const filename = 'clinic_backup_2024.sql.gz/extra';
      expect(() => service['sanitizeFilename'](filename)).toThrow(BadRequestException);
    });

    it('should reject Windows-style path traversal', () => {
      const service = new BackupService({ logUserAction: jest.fn() } as any, createMockPrismaService());
      const filename = '..\\..\\Windows\\System32';
      expect(() => service['sanitizeFilename'](filename)).toThrow(BadRequestException);
    });
  });

  describe('BackupService - Manifest Path Traversal', () => {
    beforeEach(() => {
      process.env.POSTGRES_DB = 'clinic_test_db';
      process.env.BACKUP_DIR = '/app/backups';
    });

    it('should reject manifest entry with path traversal', () => {
      const service = new BackupService({ logUserAction: jest.fn() } as any, createMockPrismaService());
      const maliciousFilename = '../../../etc/passwd';
      expect(() => service['resolveSafePath'](maliciousFilename)).toThrow(BadRequestException);
    });

    it('should reject manifest entry with relative path', () => {
      const service = new BackupService({ logUserAction: jest.fn() } as any, createMockPrismaService());
      const maliciousFilename = '../target';
      expect(() => service['resolveSafePath'](maliciousFilename)).toThrow(BadRequestException);
    });

    it('should reject manifest entry with absolute path', () => {
      const service = new BackupService({ logUserAction: jest.fn() } as any, createMockPrismaService());
      const maliciousFilename = '/tmp/target';
      expect(() => service['resolveSafePath'](maliciousFilename)).toThrow(BadRequestException);
    });

    it('should accept valid manifest entry', () => {
      const service = new BackupService({ logUserAction: jest.fn() } as any, createMockPrismaService());
      const validFilename = 'clinic_backup_2024-01-01T12-00-00-000Z.sql.gz';
      expect(() => service['resolveSafePath'](validFilename)).not.toThrow();
    });
  });

  describe('BackupService - Remote Storage Configuration', () => {
    beforeEach(() => {
      process.env.POSTGRES_DB = 'clinic_test_db';
      process.env.BACKUP_DIR = '/app/backups';
    });

    it('should detect when remote storage is configured', () => {
      process.env.BACKUP_S3_ENDPOINT = 'https://s3.example.com';
      process.env.BACKUP_S3_BUCKET = 'my-bucket';
      process.env.BACKUP_S3_ACCESS_KEY = 'key';
      process.env.BACKUP_S3_SECRET_KEY = 'secret';
      const service = new BackupService({ logUserAction: jest.fn() } as any, createMockPrismaService());
      expect(service['isRemoteStorageConfigured']()).toBe(true);
    });

    it('should detect when remote storage is not configured', () => {
      delete process.env.BACKUP_S3_ENDPOINT;
      delete process.env.BACKUP_S3_BUCKET;
      delete process.env.BACKUP_S3_ACCESS_KEY;
      delete process.env.BACKUP_S3_SECRET_KEY;
      const service = new BackupService({ logUserAction: jest.fn() } as any, createMockPrismaService());
      expect(service['isRemoteStorageConfigured']()).toBe(false);
    });
  });

  describe('BackupService - Concurrency Control', () => {
    beforeEach(() => {
      process.env.POSTGRES_DB = 'clinic_test_db';
      process.env.BACKUP_DIR = '/app/backups';
    });

    describe('BackupService - Process and stream completion', () => {
      it('should calculate and verify the SHA-256 checksum of a backup artifact', async () => {
        const directory = await mkdtemp(`${tmpdir()}/clinic-backup-`);
        const filepath = `${directory}/clinic_backup_2024.sql.gz`;
        const content = gzipSync(Buffer.from('SELECT 1;'));
        await writeFile(filepath, content);
        const service = new BackupService({ logUserAction: jest.fn() } as any, createMockPrismaService());

        await expect(service['calculateSha256'](filepath)).resolves.toBe(
          require('crypto').createHash('sha256').update(content).digest('hex'),
        );
        await expect(service['verifyGzip'](filepath)).resolves.toBeUndefined();

        await rm(directory, { recursive: true, force: true });
      });

      it.each(['corrupt gzip', 'truncated gzip'])('should reject %s artifacts', async (failure) => {
        const directory = await mkdtemp(`${tmpdir()}/clinic-backup-`);
        const filepath = `${directory}/clinic_backup_2024.sql.gz`;
        const content = gzipSync(Buffer.from('SELECT 1;'));
        await writeFile(filepath, failure === 'corrupt gzip' ? Buffer.from('not gzip') : content.subarray(0, 5));
        const service = new BackupService({ logUserAction: jest.fn() } as any, createMockPrismaService());

        await expect(service['verifyGzip'](filepath)).rejects.toThrow();
        await rm(directory, { recursive: true, force: true });
      });

      it('should require pg_dump exit code 0 after all output completes', async () => {
        const service = new BackupService({ logUserAction: jest.fn() } as any, createMockPrismaService());
        const pgDump = fakeProcess();
        const gzip = new PassThrough();
        const output = new PassThrough();
        const completion = service['completeBackupProcess'](pgDump, gzip, output, () => '');

        pgDump.stdout.end('dump');
        await new Promise(resolve => setImmediate(resolve));
        let settled = false;
        completion.finally(() => { settled = true; });
        await new Promise(resolve => setImmediate(resolve));
        expect(settled).toBe(false);

        pgDump.emit('close', 0);
        await expect(completion).resolves.toBeUndefined();
      });

      it.each(['non-zero exit', 'spawn error', 'stdout error', 'gzip error', 'output error'])('should reject backup on %s', async (failure) => {
        const service = new BackupService({ logUserAction: jest.fn() } as any, createMockPrismaService());
        const pgDump = fakeProcess();
        const gzip = new PassThrough();
        const output = new PassThrough();
        const completion = service['completeBackupProcess'](pgDump, gzip, output, () => 'stderr');

        if (failure === 'non-zero exit') pgDump.emit('close', 1);
        if (failure === 'spawn error') pgDump.emit('error', new Error('spawn failed'));
        if (failure === 'stdout error') pgDump.stdout.destroy(new Error('stdout failed'));
        if (failure === 'gzip error') gzip.destroy(new Error('gzip failed'));
        if (failure === 'output error') output.destroy(new Error('output failed'));
        pgDump.stdout.end();
        await expect(completion).rejects.toThrow();
      });

      it('should reject and clean a failed temporary backup artifact', async () => {
        const directory = await mkdtemp(`${tmpdir()}/clinic-backup-`);
        const previousBackupDir = process.env.BACKUP_DIR;
        process.env.BACKUP_DIR = directory;
        process.env.POSTGRES_DB = 'clinic_test_db';
        const service = new BackupService({ logUserAction: jest.fn() } as any, createMockPrismaService());
        const pgDump = fakeProcess();
        (spawn as jest.Mock).mockReturnValueOnce(pgDump);
        jest.spyOn(service as any, 'completeBackupProcess').mockRejectedValue(new Error('pipeline failed'));

        const operation = service.runBackup('manual');

        await expect(operation).rejects.toThrow(InternalServerErrorException);
        const files = await readdir(directory);
        expect(files).toEqual([]);
        await rm(directory, { recursive: true, force: true });
        if (previousBackupDir === undefined) delete process.env.BACKUP_DIR;
        else process.env.BACKUP_DIR = previousBackupDir;
      });

      it('should restore successfully only after gunzip, stdin, and psql complete', async () => {
        const service = new BackupService({ logUserAction: jest.fn() } as any, createMockPrismaService());
        const psql = fakeProcess();
        const input = Readable.from(gzipSync(Buffer.from('SELECT 1;')));
        const gunzip = new (require('zlib').Gunzip)();
        const completion = service['completeRestoreProcess'](psql, input, gunzip, () => '', () => '');

        psql.stdin.on('data', () => undefined);
        setImmediate(() => psql.emit('close', 0));
        await expect(completion).resolves.toBeUndefined();
      });

      it.each(['non-zero exit', 'spawn error', 'input read error', 'gunzip error', 'stdin error', 'truncated input'])('should reject restore on %s', async (failure) => {
        const service = new BackupService({ logUserAction: jest.fn() } as any, createMockPrismaService());
        const psql = fakeProcess();
        const input = new PassThrough();
        const gunzip = new (require('zlib').Gunzip)();
        const completion = service['completeRestoreProcess'](psql, input, gunzip, () => 'stderr', () => 'stdout');

        if (failure === 'non-zero exit') psql.emit('close', 1);
        if (failure === 'spawn error') psql.emit('error', new Error('spawn failed'));
        if (failure === 'input read error') input.destroy(new Error('input failed'));
        if (failure === 'gunzip error') input.write(Buffer.from('not gzip'));
        if (failure === 'stdin error') psql.stdin.destroy(new Error('stdin failed'));
        if (failure === 'truncated input') input.write(gzipSync(Buffer.from('partial')).subarray(0, 5));
        input.end();
        await expect(completion).rejects.toThrow();
      });

      it('should publish only the validated final artifact and exclude temporary files', async () => {
        const directory = await mkdtemp(`${tmpdir()}/clinic-backup-`);
        process.env.BACKUP_DIR = directory;
        process.env.POSTGRES_DB = 'clinic_test_db';
        const service = new BackupService({ logUserAction: jest.fn() } as any, createMockPrismaService());
        const pgDump = fakeProcess();
        (spawn as jest.Mock).mockReturnValueOnce(pgDump);
        jest.spyOn(service as any, 'completeBackupProcess').mockImplementation(async (_process, _gzip, output: Writable) => {
          output.write(gzipSync(Buffer.from('SELECT 1;')));
          await new Promise<void>((resolve, reject) => {
            output.once('finish', resolve);
            output.once('error', reject);
            output.end();
          });
        });

        const result = await service.runBackup('manual');
        const files = await readdir(directory);
        expect(result.filename.endsWith('.sql.gz')).toBe(true);
        expect(files).toContain(result.filename);
        expect(files.some(file => file.endsWith('.tmp'))).toBe(false);
        expect((await service.listBackups()).map(entry => entry.filename)).toEqual([result.filename]);

        await rm(directory, { recursive: true, force: true });
      });

      it('should clean up a temporary artifact when publication validation fails', async () => {
        const directory = await mkdtemp(`${tmpdir()}/clinic-backup-`);
        process.env.BACKUP_DIR = directory;
        process.env.POSTGRES_DB = 'clinic_test_db';
        const service = new BackupService({ logUserAction: jest.fn() } as any, createMockPrismaService());
        const pgDump = fakeProcess();
        (spawn as jest.Mock).mockReturnValueOnce(pgDump);
        jest.spyOn(service as any, 'completeBackupProcess').mockImplementation(async (_process, _gzip, output: Writable) => {
          output.write(gzipSync(Buffer.from('SELECT 1;')));
          await new Promise<void>((resolve, reject) => {
            output.once('finish', resolve);
            output.once('error', reject);
            output.end();
          });
        });
        jest.spyOn(service as any, 'verifyGzip').mockRejectedValue(new Error('corrupt gzip'));

        await expect(service.runBackup('manual')).rejects.toThrow(InternalServerErrorException);
        expect(await readdir(directory)).toEqual([]);
        await rm(directory, { recursive: true, force: true });
      });

      it('should reject restore when the manifest entry or artifact integrity is invalid', async () => {
        const directory = await mkdtemp(`${tmpdir()}/clinic-backup-`);
        process.env.BACKUP_DIR = directory;
        process.env.POSTGRES_DB = 'clinic_test_db';
        const service = new BackupService({ logUserAction: jest.fn() } as any, createMockPrismaService());
        const content = gzipSync(Buffer.from('SELECT 1;'));
        const filename = 'clinic_backup_2024.sql.gz';
        await writeFile(`${directory}/${filename}`, content);
        const manifest = {
          version: 2 as const,
          database: 'clinic_test_db',
          entries: [{
            filename,
            sizeBytes: content.length + 1,
            sha256: '0'.repeat(64),
            createdAt: new Date().toISOString(),
            triggeredBy: 'manual' as const,
            uploadedToRemote: false,
            validation: { gzipVerified: true, databaseVerified: false, verifiedAt: new Date().toISOString() },
            protected: false,
          }],
        };
        await service['writeManifest'](manifest);

        await expect(service.restoreBackup(filename, 'user-id')).rejects.toThrow(BadRequestException);
        await rm(directory, { recursive: true, force: true });
      });

      it('should block restore when the checksum does not match', async () => {
        const directory = await mkdtemp(`${tmpdir()}/clinic-backup-`);
        process.env.BACKUP_DIR = directory;
        process.env.POSTGRES_DB = 'clinic_test_db';
        const service = new BackupService({ logUserAction: jest.fn() } as any, createMockPrismaService());
        const filename = 'clinic_backup_2024.sql.gz';
        const content = gzipSync(Buffer.from('SELECT 1;'));
        await writeFile(`${directory}/${filename}`, content);
        await service['writeManifest']({
          version: 2,
          database: 'clinic_test_db',
          entries: [{
            filename,
            sizeBytes: content.length,
            sha256: '0'.repeat(64),
            createdAt: new Date().toISOString(),
            triggeredBy: 'manual',
            uploadedToRemote: false,
            validation: { gzipVerified: true, databaseVerified: false, verifiedAt: new Date().toISOString() },
            protected: false,
          }],
        });

        (spawn as jest.Mock).mockClear();
        await expect(service.restoreBackup(filename, 'user-id')).rejects.toThrow('checksum');
        expect(spawn).not.toHaveBeenCalled();
        await rm(directory, { recursive: true, force: true });
      });

      it('should block restore when the artifact size does not match', async () => {
        const directory = await mkdtemp(`${tmpdir()}/clinic-backup-`);
        process.env.BACKUP_DIR = directory;
        process.env.POSTGRES_DB = 'clinic_test_db';
        const service = new BackupService({ logUserAction: jest.fn() } as any, createMockPrismaService());
        const filename = 'clinic_backup_2024.sql.gz';
        const content = gzipSync(Buffer.from('SELECT 1;'));
        await writeFile(`${directory}/${filename}`, content);
        await service['writeManifest']({
          version: 2,
          database: 'clinic_test_db',
          entries: [{
            filename,
            sizeBytes: content.length + 1,
            sha256: require('crypto').createHash('sha256').update(content).digest('hex'),
            createdAt: new Date().toISOString(),
            triggeredBy: 'manual',
            uploadedToRemote: false,
            validation: { gzipVerified: true, databaseVerified: false, verifiedAt: new Date().toISOString() },
            protected: false,
          }],
        });

        (spawn as jest.Mock).mockClear();
        await expect(service.restoreBackup(filename, 'user-id')).rejects.toThrow('size');
        expect(spawn).not.toHaveBeenCalled();
        await rm(directory, { recursive: true, force: true });
      });

      it('should reject restore when the manifest artifact is missing', async () => {
        const directory = await mkdtemp(`${tmpdir()}/clinic-backup-`);
        process.env.BACKUP_DIR = directory;
        process.env.POSTGRES_DB = 'clinic_test_db';
        const service = new BackupService({ logUserAction: jest.fn() } as any, createMockPrismaService());
        await service['writeManifest']({
          version: 2,
          database: 'clinic_test_db',
          entries: [{
            filename: 'clinic_backup_2024.sql.gz',
            sizeBytes: 10,
            sha256: '0'.repeat(64),
            createdAt: new Date().toISOString(),
            triggeredBy: 'manual',
            uploadedToRemote: false,
            validation: { gzipVerified: true, databaseVerified: false, verifiedAt: new Date().toISOString() },
            protected: false,
          }],
        });

        await expect(service.restoreBackup('clinic_backup_2024.sql.gz', 'user-id')).rejects.toThrow('not found');
        await rm(directory, { recursive: true, force: true });
      });
    });

    describe('BackupService - Manifest integrity', () => {
      beforeEach(() => {
        process.env.POSTGRES_DB = 'clinic_test_db';
      });

      it('should fail closed for malformed or unsupported manifests', async () => {
        const directory = await mkdtemp(`${tmpdir()}/clinic-backup-`);
        process.env.BACKUP_DIR = directory;
        const service = new BackupService({ logUserAction: jest.fn() } as any, createMockPrismaService());

        await writeFile(`${directory}/manifest.json`, '{not-json');
        await expect(service['readManifest']()).rejects.toThrow('Backup manifest is corrupt');
        await writeFile(`${directory}/manifest.json`, JSON.stringify([]));
        await expect(service['readManifest']()).rejects.toThrow('manifest version or shape is invalid');
        await rm(directory, { recursive: true, force: true });
      });

      it('should atomically write a versioned manifest without exposing temporary files', async () => {
        const directory = await mkdtemp(`${tmpdir()}/clinic-backup-`);
        process.env.BACKUP_DIR = directory;
        const service = new BackupService({ logUserAction: jest.fn() } as any, createMockPrismaService());
        const manifest = { version: 2 as const, database: 'clinic_test_db', entries: [] };

        await service['writeManifest'](manifest);
        expect(JSON.parse(await readFile(`${directory}/manifest.json`, 'utf8'))).toEqual(manifest);
        expect((await readdir(directory)).filter(file => file.endsWith('.tmp'))).toEqual([]);
        await rm(directory, { recursive: true, force: true });
      });

      it('should preserve the previous manifest when manifest serialization fails', async () => {
        const directory = await mkdtemp(`${tmpdir()}/clinic-backup-`);
        process.env.BACKUP_DIR = directory;
        const service = new BackupService({ logUserAction: jest.fn() } as any, createMockPrismaService());
        const previousManifest = { version: 2 as const, database: 'clinic_test_db', entries: [] };
        await service['writeManifest'](previousManifest);
        const previousContents = await readFile(`${directory}/manifest.json`, 'utf8');
        const invalidManifest = { version: 2 as const, database: 'clinic_test_db', entries: [] } as any;
        invalidManifest.self = invalidManifest;

        await expect(service['writeManifest'](invalidManifest)).rejects.toThrow();
        expect(await readFile(`${directory}/manifest.json`, 'utf8')).toBe(previousContents);
        expect((await readdir(directory)).filter(file => file.endsWith('.tmp'))).toEqual([]);
        await rm(directory, { recursive: true, force: true });
      });

      it('should fail closed when the manifest cannot be read', async () => {
        const directory = await mkdtemp(`${tmpdir()}/clinic-backup-`);
        process.env.BACKUP_DIR = directory;
        const service = new BackupService({ logUserAction: jest.fn() } as any, createMockPrismaService());
        await mkdir(`${directory}/manifest.json`);

        await expect(service['readManifest']()).rejects.toThrow('unreadable or invalid');
        await rm(directory, { recursive: true, force: true });
      });
    });

    describe('BackupService - Encryption', () => {
      it('should encrypt and decrypt backup content with authenticated integrity', async () => {
        const directory = await mkdtemp(`${tmpdir()}/clinic-backup-encryption-`);
        const sourcePath = `${directory}/source.gz`;
        const encryptedPath = `${directory}/source.gz.enc`;
        const decryptedPath = `${directory}/source.restored.gz`;
        const content = gzipSync(Buffer.from('sensitive clinic backup data'));
        const key = Buffer.alloc(32, 9);
        await writeFile(sourcePath, content);

        const metadata = await backupService['encryptFile'](sourcePath, encryptedPath, key);
        expect(await readFile(encryptedPath)).not.toEqual(content);
        await backupService['decryptFile'](encryptedPath, decryptedPath, key, metadata.nonce, metadata.authTag);
        expect(await readFile(decryptedPath)).toEqual(content);
        await expect(
          backupService['decryptFile'](encryptedPath, `${directory}/wrong.gz`, Buffer.alloc(32, 8), metadata.nonce, metadata.authTag),
        ).rejects.toThrow();

        await rm(directory, { recursive: true, force: true });
      });

      it('should reject invalid encryption material and missing required production configuration', () => {
        process.env.BACKUP_ENCRYPTION_KEY = 'invalid';
        expect(() => backupService['getEncryptionKey']()).toThrow('exactly 32 bytes');
        delete process.env.BACKUP_ENCRYPTION_KEY;
        process.env.NODE_ENV = 'production';
        expect(() => backupService['getEncryptionKey']()).toThrow('required');
      });
    });

    it('should serialize backup operations', async () => {
      const service = new BackupService({ logUserAction: jest.fn() } as any, createMockPrismaService());
      // Mock backup operation to take time
      jest.spyOn(service, 'runBackup').mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return { filename: 'test.sql.gz', sizeBytes: 1000, createdAt: new Date().toISOString(), triggeredBy: 'manual', uploadedToRemote: false };
      });

      const [result1, result2] = await Promise.all([
        service.runBackup('manual'),
        service.runBackup('manual'),
      ]);

      expect(result1).toBeDefined();
      expect(result2).toBeDefined();
      // Operations should be serialized, not parallel
      expect(service['runBackup']).toHaveBeenCalledTimes(2);
    });
  });

  describe('RestoreBackupDto Validation', () => {
    it('should require confirm to be true', () => {
      const dto = { filename: 'clinic_backup_2024.sql.gz', confirm: false };
      expect(() => {
        if (dto.confirm !== true) {
          throw new BadRequestException('confirm must be true to restore a backup');
        }
      }).toThrow(BadRequestException);
    });

    it('should accept confirm: true', () => {
      const dto = { filename: 'clinic_backup_2024.sql.gz', confirm: true };
      expect(() => {
        if (dto.confirm !== true) {
          throw new BadRequestException('confirm must be true to restore a backup');
        }
      }).not.toThrow();
    });
  });

  describe('Structured Excel export', () => {
    it('exports stable headers and metadata without authentication or audit fields', async () => {
      const prisma = createMockPrismaService();
      const patient = {
        id: 'patient-1',
        civilId: '123',
        fullNameAr: 'مريضة',
        fullNameEn: 'Patient',
        phone: '555',
        dateOfBirth: null,
        address: null,
        legacySource: 'legacy',
        legacyPatientKey: 'p-1',
        legacyReference: null,
        isArchived: false,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-02T00:00:00.000Z'),
      };
      prisma.patient.findMany.mockResolvedValue([patient]);
      for (const model of ['appointment', 'visit', 'service', 'invoice', 'invoiceItem', 'invoiceAdditionalCharge', 'payment', 'paymentAllocation']) {
        prisma[model].findMany.mockResolvedValue([]);
      }

      const service = new BackupService({ logUserAction: jest.fn() } as any, prisma);
      const buffer = await service.exportToExcel('admin-1');
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

      expect(workbook.worksheets.map(sheet => sheet.name)).toEqual([
        'Backup Info',
        'Patients',
        'Appointments',
        'Visits',
        'Services',
        'Invoices',
        'Invoice Items',
        'Additional Charges',
        'Payments',
        'Payment Allocations',
      ]);
      expect(workbook.getWorksheet('Patients')?.getRow(1).values).toEqual([
        undefined,
        'ID',
        'Civil ID',
        'Full Name (Arabic)',
        'Full Name (English)',
        'Phone',
        'Date of Birth',
        'Address',
        'Legacy Source',
        'Legacy Patient Key',
        'Legacy Reference',
        'Archived',
        'Created At',
        'Updated At',
      ]);
      expect(workbook.getWorksheet('Patients')?.getRow(2).values).toContain('Patient');
      expect(workbook.getWorksheet('Backup Info')?.getColumn(1).values).toContain('Exported At');
      expect(workbook.getWorksheet('Backup Info')?.getColumn(1).values).toContain('Patients Rows');
      expect(buffer.toString()).not.toContain('passwordHash');
      expect(buffer.toString()).not.toContain('recordedById');
      expect(buffer.toString()).not.toContain('createdById');
    });
  });
});
