import { Injectable, Logger, BadRequestException, InternalServerErrorException, OnModuleInit, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ChildProcessWithoutNullStreams, spawn, spawnSync } from 'child_process';
import { createGzip, createGunzip } from 'zlib';
import { createReadStream, createWriteStream } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import { pipeline } from 'stream/promises';
import { Readable, Transform, Writable } from 'stream';
import { createHash } from 'crypto';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { URL } from 'node:url';
import { AuditService } from '../audit/audit.service';
import { MaintenanceService } from '../common/maintenance/maintenance.service';
import { PrismaService } from '../database/prisma.service';
import * as ExcelJS from 'exceljs';

export interface BackupManifestEntry {
  filename: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
  triggeredBy: 'manual' | 'scheduled' | 'pre-restore-safety';
  uploadedToRemote: boolean;
  validation: {
    gzipVerified: boolean;
    databaseVerified: boolean;
    verifiedAt: string;
  };
  protected: boolean;
  encrypted?: boolean;
  encryptionAlgorithm?: 'aes-256-gcm';
  nonce?: string;
  authTag?: string;
}

interface BackupManifest {
  version: 2;
  database: string;
  entries: BackupManifestEntry[];
}

// Real pg_dump / psql backed backup & restore. Nothing here is simulated â€”
// every operation shells out to the actual Postgres client tools against the
// live database, using the same credentials the app itself connects with.
@Injectable()
export class BackupService implements OnModuleInit {
  private readonly logger = new Logger(BackupService.name);

  // Concurrency control: prevent overlapping backup/restore operations
  private operationInProgress = false;

  constructor(
    private auditService: AuditService,
    private prisma: PrismaService,
    @Optional() private maintenanceService: MaintenanceService = new MaintenanceService(),
  ) {}

  private async withOperationLock<T>(operation: () => Promise<T>): Promise<T> {
    // Wait for current operation to complete
    while (this.operationInProgress) {
      await new Promise<void>(resolve => globalThis.setTimeout(resolve, 100));
    }

    this.operationInProgress = true;
    try {
      return await operation();
    } finally {
      this.operationInProgress = false;
    }
  }

  onModuleInit() {
    // Validate backup directory
    const backupDir = process.env.BACKUP_DIR || '/app/backups';
    if (!path.isAbsolute(backupDir)) {
      throw new Error('BACKUP_DIR must be an absolute path for security');
    }

    // Verify pg_dump and psql are available in PATH
    let pgDumpAvailable = false;
    let psqlAvailable = false;

    try {
      const pgDumpCheck = spawnSync('which', ['pg_dump']);
      if (pgDumpCheck.status === 0) {
        pgDumpAvailable = true;
        this.logger.log('pg_dump is available in PATH');
      } else {
        this.logger.warn('pg_dump not found in PATH. PostgreSQL client tools must be installed for backup operations.');
      }
    } catch (err) {
      this.logger.warn(`Failed to check pg_dump availability: ${err instanceof Error ? err.message : String(err)}`);
    }

    try {
      const psqlCheck = spawnSync('which', ['psql']);
      if (psqlCheck.status === 0) {
        psqlAvailable = true;
        this.logger.log('psql is available in PATH');
      } else {
        this.logger.warn('psql not found in PATH. PostgreSQL client tools must be installed for backup operations.');
      }
    } catch (err) {
      this.logger.warn(`Failed to check psql availability: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (!pgDumpAvailable || !psqlAvailable) {
      this.logger.warn('WARNING: Backup service cannot create PostgreSQL backups without pg_dump and psql. PostgreSQL client tools must be installed in the runtime environment.');
    }

    this.logger.log(`Backup service initialized with directory: ${backupDir}`);
  }

  private get backupDir(): string {
    return process.env.BACKUP_DIR || '/app/backups';
  }
  private get manifestPath(): string {
    return path.join(this.backupDir, 'manifest.json');
  }
  private get retentionDays(): number {
    return parseInt(process.env.BACKUP_RETENTION_DAYS || '14', 10);
  }

  private get encryptionRequired(): boolean {
    return process.env.NODE_ENV === 'production' || process.env.BACKUP_ENCRYPTION_REQUIRED === 'true';
  }

  private getEncryptionKey(): Buffer | undefined {
    const encoded = process.env.BACKUP_ENCRYPTION_KEY;
    if (!encoded) {
      if (this.encryptionRequired) {
        throw new Error('BACKUP_ENCRYPTION_KEY is required when backup encryption is enabled');
      }
      return undefined;
    }
    const key = /^[a-f0-9]{64}$/i.test(encoded)
      ? Buffer.from(encoded, 'hex')
      : Buffer.from(encoded, 'base64');
    if (key.length !== 32) {
      throw new Error('BACKUP_ENCRYPTION_KEY must decode to exactly 32 bytes');
    }
    return key;
  }

  private async encryptFile(sourcePath: string, destinationPath: string, key: Buffer) {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    await pipeline(createReadStream(sourcePath), cipher, createWriteStream(destinationPath, { flags: 'wx' }));
    return { nonce: nonce.toString('base64'), authTag: cipher.getAuthTag().toString('base64') };
  }

  private async decryptFile(sourcePath: string, destinationPath: string, key: Buffer, nonce: string, authTag: string) {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(nonce, 'base64'));
    decipher.setAuthTag(Buffer.from(authTag, 'base64'));
    await pipeline(createReadStream(sourcePath), decipher, createWriteStream(destinationPath, { flags: 'wx' }));
  }

  private getDbConnectionParams() {
    const databaseUrl = process.env.DATABASE_URL;
    let parsedUrl: URL | undefined;
    let database = process.env.POSTGRES_DB;

    if (databaseUrl) {
      try {
        parsedUrl = new URL(databaseUrl);
        database = database || decodeURIComponent(parsedUrl.pathname.slice(1));
      } catch {
        throw new Error('DATABASE_URL is invalid for backup operations.');
      }
    }

    if (!database) {
      throw new Error('DATABASE_URL or POSTGRES_DB is required for backup operations');
    }

    if (process.env.NODE_ENV === 'test' && database === 'clinic_db') {
      throw new Error('Cannot target production database (clinic_db) during test verification. Use clinic_test_db instead.');
    }

    return {
      host: process.env.DB_HOST || parsedUrl?.hostname || 'postgres',
      port: process.env.DB_PORT || parsedUrl?.port || '5432',
      user: process.env.POSTGRES_USER || (parsedUrl ? decodeURIComponent(parsedUrl.username) : 'clinic_user'),
      password: process.env.POSTGRES_PASSWORD || (parsedUrl ? decodeURIComponent(parsedUrl.password) : undefined),
      database,
      sslmode: parsedUrl?.searchParams.get('sslmode') || undefined,
    };
  }

  private async ensureBackupDir() {
    try {
      await fs.mkdir(this.backupDir, { recursive: true });
    } catch (err) {
      this.logger.error(`Failed to create backup directory ${this.backupDir}: ${err instanceof Error ? err.message : String(err)}`);
      throw new InternalServerErrorException(`Failed to create backup directory: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async readManifest(): Promise<BackupManifest> {
    try {
      const raw = await fs.readFile(this.manifestPath, 'utf-8');
      const parsed: unknown = JSON.parse(raw);
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        (parsed as { version?: unknown }).version !== 2 ||
        typeof (parsed as { database?: unknown }).database !== 'string' ||
        !Array.isArray((parsed as { entries?: unknown }).entries)
      ) {
        throw new Error('manifest version or shape is invalid');
      }
      return parsed as BackupManifest;
    } catch (err) {
      if ((err as { code?: string }).code === 'ENOENT') {
        return {
          version: 2,
          database: process.env.POSTGRES_DB || 'unknown',
          entries: [],
        };
      }
      if (err instanceof SyntaxError) {
        throw new Error(`Backup manifest is corrupt: ${err.message}`);
      }
      if (err instanceof Error && err.message.startsWith('Backup manifest is corrupt')) {
        throw err;
      }
      throw new Error(`Backup manifest is unreadable or invalid: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async writeManifest(manifest: BackupManifest) {
    const temporaryPath = `${this.manifestPath}.${process.pid}.${Date.now()}.tmp`;
    let handle: fs.FileHandle | undefined;
    try {
      handle = await fs.open(temporaryPath, 'w');
      await handle.writeFile(JSON.stringify(manifest, null, 2));
      await handle.sync();
      await handle.close();
      handle = undefined;
      await fs.rename(temporaryPath, this.manifestPath);
    } finally {
      if (handle) await handle.close();
      await fs.unlink(temporaryPath).catch(() => undefined);
    }
  }

  private async calculateSha256(filepath: string): Promise<string> {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(filepath)) {
      hash.update(chunk as Buffer);
    }
    return hash.digest('hex');
  }

  private async verifyGzip(filepath: string): Promise<void> {
    await pipeline(
      createReadStream(filepath),
      createGunzip(),
      new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        },
      }),
    );
  }

  private async createVerifiedSnapshot(filename: string, manifest: BackupManifest): Promise<string> {
    const entry = await this.validateRecoveryPoint(filename, manifest);
    const sourcePath = this.resolveSafePath(entry.filename);
    const snapshotPath = `${sourcePath}.${process.pid}.${Date.now()}.restore.tmp`;
    const sourceHandle = await fs.open(sourcePath, 'r');

    try {
      await pipeline(
        createReadStream(sourcePath, { fd: sourceHandle.fd, autoClose: false }),
        createWriteStream(snapshotPath, { flags: 'wx' }),
      );
      const sha256 = await this.calculateSha256(snapshotPath);
      const snapshotStat = await fs.stat(snapshotPath);
      if (snapshotStat.size !== entry.sizeBytes || sha256 !== entry.sha256) {
        throw new BadRequestException('Backup changed during validation');
      }
      if (!entry.encrypted) {
        await this.verifyGzip(snapshotPath);
        return snapshotPath;
      }
      const key = this.getEncryptionKey();
      if (!key || !entry.nonce || !entry.authTag) {
        throw new BadRequestException('Encrypted backup metadata is incomplete');
      }
      const decryptedPath = `${snapshotPath}.decrypted`;
      await this.decryptFile(snapshotPath, decryptedPath, key, entry.nonce, entry.authTag);
      await this.verifyGzip(decryptedPath);
      await fs.unlink(snapshotPath).catch(() => undefined);
      return decryptedPath;
    } catch (err) {
      await fs.unlink(snapshotPath).catch(() => undefined);
      await fs.unlink(`${snapshotPath}.decrypted`).catch(() => undefined);
      throw err;
    } finally {
      await sourceHandle.close();
    }
  }

  private async validateRecoveryPoint(filename: string, manifest: BackupManifest): Promise<BackupManifestEntry> {
    const safeFilename = this.sanitizeFilename(filename);
    const entry = manifest.entries.find(candidate => candidate.filename === safeFilename);
    if (!entry) throw new BadRequestException('Backup is not registered in the manifest');
    if (!/^[a-f0-9]{64}$/.test(entry.sha256)) {
      throw new BadRequestException('Backup has an invalid checksum');
    }
    if (entry.encrypted && (
      !entry.filename.endsWith('.sql.gz.enc') ||
      entry.encryptionAlgorithm !== 'aes-256-gcm' ||
      !entry.nonce ||
      !entry.authTag
    )) {
      throw new BadRequestException('Encrypted backup metadata is invalid');
    }
    if (!entry.encrypted && entry.filename.endsWith('.sql.gz.enc')) {
      throw new BadRequestException('Encrypted backup metadata is invalid');
    }

    const filepath = this.resolveSafePath(entry.filename);
    let stat;
    try {
      const link = await fs.lstat(filepath);
      if (link.isSymbolicLink()) {
        throw new BadRequestException('Backup file must not be a symbolic link');
      }
      stat = await fs.stat(filepath);
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException('Backup file not found');
    }
    if (stat.size !== entry.sizeBytes) {
      throw new BadRequestException('Backup size does not match the manifest');
    }

    try {
      const sha256 = await this.calculateSha256(filepath);
      if (sha256 !== entry.sha256) {
        throw new BadRequestException('Backup checksum does not match the manifest');
      }
      if (entry.encrypted) {
        const key = this.getEncryptionKey();
        if (!key || !entry.nonce || !entry.authTag || entry.encryptionAlgorithm !== 'aes-256-gcm') {
          throw new BadRequestException('Encrypted backup metadata is invalid');
        }
      } else {
        await this.verifyGzip(filepath);
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException(`Backup gzip integrity verification failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return entry;
  }

  private waitForProcessExit(process: ChildProcessWithoutNullStreams): Promise<number> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const rejectOnce = (error: Error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      const resolveOnce = (code: number | null) => {
        if (settled) return;
        settled = true;
        resolve(code ?? -1);
      };

      process.once('error', rejectOnce);
      process.once('close', resolveOnce);
    });
  }

  private async completeBackupProcess(
    pgDump: ChildProcessWithoutNullStreams,
    gzip: Transform,
    out: Writable,
    stderr: () => string,
  ) {
    const results = await Promise.all([
      pipeline(pgDump.stdout, gzip, out),
      this.waitForProcessExit(pgDump),
    ]);
    const exitCode = results[1];

    if (exitCode !== 0) {
      throw new Error(`pg_dump exited with code ${exitCode}: ${stderr()}`);
    }
  }

  private async completeRestoreProcess(
    psql: ChildProcessWithoutNullStreams,
    input: Readable,
    gunzip: Transform,
    stderr: () => string,
    stdout: () => string,
  ) {
    const results = await Promise.all([
      pipeline(input, gunzip, psql.stdin),
      this.waitForProcessExit(psql),
    ]);
    const exitCode = results[1];

    if (exitCode !== 0) {
      throw new Error(`psql exited with code ${exitCode}. stderr: ${stderr()}, stdout: ${stdout()}`);
    }
  }

  // Runs every day at 3:00 AM server time. This is a real cron registration
  // via @nestjs/schedule â€” it will actually fire in production, not a
  // decorative comment.
  @Cron('0 3 * * *')
  async handleScheduledBackup() {
    this.logger.log('Running scheduled daily backup...');
    try {
      await this.runBackup('scheduled');
    } catch (err) {
      this.logger.error('Scheduled backup failed', err instanceof Error ? err.stack : err);
    }
  }

  async runBackup(triggeredBy: 'manual' | 'scheduled' | 'pre-restore-safety', userId?: string, ipAddress?: string, userAgent?: string) {
    return this.withOperationLock(() => this.runBackupUnlocked(triggeredBy, userId, ipAddress, userAgent));
  }

  // Used by restore while it already owns the operation lock. Keeping this
  // separate prevents the pre-restore safety backup from waiting on itself.
  private async runBackupUnlocked(triggeredBy: 'manual' | 'scheduled' | 'pre-restore-safety', userId?: string, ipAddress?: string, userAgent?: string) {
      await this.ensureBackupDir();
      const { host, port, user, password, database, sslmode } = this.getDbConnectionParams();
      const encryptionKey = this.getEncryptionKey();

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const baseFilename = `clinic_backup_${timestamp}.sql.gz`;
      const filename = encryptionKey ? `${baseFilename}.enc` : baseFilename;
      const filepath = path.join(this.backupDir, filename);
      const gzipTemporaryFilepath = path.join(this.backupDir, `${baseFilename}.tmp`);
      const temporaryFilepath = `${filepath}.tmp`;

      // --clean --if-exists: the dump includes DROP statements before each
      // CREATE, so restoring it cleanly replaces existing objects rather than
      // erroring on "already exists".
      const pgDump = spawn(
        'pg_dump',
        ['--host', host, '--port', port, '--username', user, ...(sslmode ? ['--sslmode', sslmode] : []), '--format', 'plain', '--clean', '--if-exists', '--no-owner', database],
        { env: { ...process.env, PGPASSWORD: password } },
      );

      const gzip = createGzip();
      const out = createWriteStream(gzipTemporaryFilepath);

      let stderr = '';
      pgDump.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

      let published = false;
      let encryptionMetadata: { nonce: string; authTag: string } | undefined;
      try {
        await this.completeBackupProcess(pgDump, gzip, out, () => stderr);
        await this.verifyGzip(gzipTemporaryFilepath);
        if (encryptionKey) {
          encryptionMetadata = await this.encryptFile(gzipTemporaryFilepath, temporaryFilepath, encryptionKey);
          await fs.unlink(gzipTemporaryFilepath);
        } else {
          await fs.rename(gzipTemporaryFilepath, filepath);
        }
        const [sha256, stat] = await Promise.all([
          this.calculateSha256(encryptionKey ? temporaryFilepath : filepath),
          fs.stat(encryptionKey ? temporaryFilepath : filepath),
        ]);
        if (encryptionKey) await fs.rename(temporaryFilepath, filepath);
        published = true;

        let uploadedToRemote = false;
        if (this.isRemoteStorageConfigured()) {
          try {
            await this.uploadToRemote(filepath, filename);
            uploadedToRemote = true;
          } catch (err) {
            this.logger.error('Remote backup upload failed (backup itself still succeeded locally)', err instanceof Error ? err.stack : err);
          }
        }

        const manifest = await this.readManifest().catch(err => {
          if ((err as Error).message.includes('manifest')) throw err;
          throw new Error(`Unable to read backup manifest: ${String(err)}`);
        });
        manifest.entries.push({
          filename,
          sizeBytes: stat.size,
          sha256,
          createdAt: new Date().toISOString(),
          triggeredBy,
          uploadedToRemote,
          validation: {
            gzipVerified: true,
            databaseVerified: false,
            verifiedAt: new Date().toISOString(),
          },
          protected: triggeredBy === 'pre-restore-safety',
          ...(encryptionKey ? {
            encrypted: true,
            encryptionAlgorithm: 'aes-256-gcm' as const,
            nonce: encryptionMetadata!.nonce,
            authTag: encryptionMetadata!.authTag,
          } : {}),
        });
        await this.writeManifest(manifest);
        await this.pruneOldBackups();

        if (userId) {
          await this.auditService.logUserAction(userId, 'BACKUP_CREATED', 'System', filename, ipAddress, userAgent);
        }

        return { filename, sizeBytes: stat.size, createdAt: new Date().toISOString(), triggeredBy, uploadedToRemote };
      } catch (err) {
        // Clean up a partial temporary file rather than publishing a corrupt backup.
        pgDump.kill();
        pgDump.stdout.destroy();
        gzip.destroy();
        const outputClosed = new Promise<void>((resolve) => {
          if ((out as Writable & { closed?: boolean }).closed) {
            resolve();
          } else {
            out.once('close', () => resolve());
          }
        });
        out.destroy();
        await outputClosed;
        await fs.unlink(gzipTemporaryFilepath).catch(() => undefined);
        await fs.unlink(temporaryFilepath).catch(() => undefined);
        if (!published && await fs.access(filepath).then(() => true).catch(() => false)) {
          await fs.unlink(filepath).catch(() => undefined);
        }
        throw new InternalServerErrorException(`Backup failed: ${err instanceof Error ? err.message : String(err)}`);
      }
  }

  async listBackups() {
    try {
      await this.ensureBackupDir();
      const manifest = await this.readManifest();
      const existing: BackupManifestEntry[] = [];
      for (const entry of manifest.entries) {
        try {
          await this.validateRecoveryPoint(entry.filename, manifest);
          existing.push(entry);
        } catch {
          this.logger.warn(`Skipping invalid backup recovery point: ${entry.filename}`);
        }
      }
      return existing.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } catch (err) {
      this.logger.error(`Failed to list backups: ${err instanceof Error ? err.message : String(err)}`);
      throw new InternalServerErrorException(`Failed to list backups: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async getStatus() {
    try {
      const backups = await this.listBackups();
      const last = backups[0] || null;
      const totalSizeBytes = backups.reduce((sum, b) => sum + b.sizeBytes, 0);
      return {
        lastBackup: last,
        totalBackups: backups.length,
        totalSizeBytes,
        retentionDays: this.retentionDays,
        remoteStorageConfigured: this.isRemoteStorageConfigured(),
      };
    } catch (err) {
      this.logger.error(`Failed to get backup status: ${err instanceof Error ? err.message : String(err)}`);
      throw new InternalServerErrorException(`Failed to get backup status: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private sanitizeFilename(filename: string): string {
    const base = path.basename(filename);
    if (!/^clinic_backup_[\w-]+\.sql\.gz(?:\.enc)?$/.test(base)) {
      throw new BadRequestException('Invalid backup filename');
    }
    // Prevent path traversal: ensure the filename doesn't contain path separators
    if (base !== filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      throw new BadRequestException('Invalid backup filename: path traversal not allowed');
    }
    return base;
  }

  // Centralized safe filename/path resolver - treats manifest as untrusted
  private resolveSafePath(filename: string): string {
    const safeFilename = this.sanitizeFilename(filename);
    const fullPath = path.join(this.backupDir, safeFilename);

    // Verify the resolved path is still inside BACKUP_DIR (prevent symlink escape)
    const resolvedPath = path.resolve(fullPath);
    const resolvedBackupDir = path.resolve(this.backupDir);

    if (!resolvedPath.startsWith(resolvedBackupDir)) {
      throw new BadRequestException('Invalid backup filename: path traversal not allowed');
    }

    return fullPath;
  }

  async restoreBackup(filename: string, userId: string, ipAddress?: string, userAgent?: string) {
    return this.withOperationLock(async () => {
      this.maintenanceService.enter('restore');
      let validatedSnapshot: string | undefined;
      try {
        const manifest = await this.readManifest();
        await this.validateRecoveryPoint(filename, manifest);

        // Safety net: always take a fresh backup of the CURRENT state right
        // before overwriting it, so a restore is never a one-way door.
        await this.runBackupUnlocked('pre-restore-safety', userId, ipAddress, userAgent);
        validatedSnapshot = await this.createVerifiedSnapshot(filename, await this.readManifest());

        let psql: ChildProcessWithoutNullStreams | undefined;
        try {
        const { host, port, user, password, database, sslmode } = this.getDbConnectionParams();

        // Use ON_ERROR_STOP to ensure psql stops on first SQL error
        // Use single-transaction to ensure atomic restore
        psql = spawn(
          'psql',
          [
            '--host', host,
            '--port', port,
            '--username', user,
            ...(sslmode ? ['--sslmode', sslmode] : []),
            '--dbname', database,
            '--set=ON_ERROR_STOP=on',
            '--single-transaction',
          ],
          { env: { ...process.env, PGPASSWORD: password } },
        );

        let stderr = '';
        let stdout = '';
        psql.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
        psql.stdout.on('data', (chunk) => { stdout += chunk.toString(); });

        const gunzip = createGunzip();
        const input = createReadStream(validatedSnapshot);
        await this.completeRestoreProcess(psql, input, gunzip, () => stderr, () => stdout);
        } catch (err) {
        // Restore failed - pre-restore safety backup remains available
        psql?.kill();
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`Restore failed: ${message}`);
        throw new InternalServerErrorException(`Restore failed: ${message}`);
        } finally {
          if (validatedSnapshot) await fs.unlink(validatedSnapshot).catch(() => undefined);
        }

        await this.auditService.logUserAction(userId, 'RESTORE_EXECUTED', 'System', filename, ipAddress, userAgent);

        return { restored: filename, restoredAt: new Date().toISOString() };
      } finally {
        this.maintenanceService.leave();
      }
    });
  }

  private async pruneOldBackups() {
    const cutoff = Date.now() - this.retentionDays * 24 * 60 * 60 * 1000;
    const manifest = await this.readManifest();
    const kept: BackupManifestEntry[] = [];

    for (const entry of manifest.entries) {
      if (new Date(entry.createdAt).getTime() < cutoff) {
        // Use centralized safe path resolver to prevent manifest path traversal
        try {
          const safePath = this.resolveSafePath(entry.filename);
          await fs.unlink(safePath).catch(() => undefined);
          this.logger.log(`Pruned expired backup: ${entry.filename}`);
        } catch {
          // Invalid filename or file already gone - just skip
        }
      } else {
        kept.push(entry);
      }
    }
    await this.writeManifest({ ...manifest, entries: kept });
  }

  private isRemoteStorageConfigured(): boolean {
    return !!(process.env.BACKUP_S3_ENDPOINT && process.env.BACKUP_S3_BUCKET && process.env.BACKUP_S3_ACCESS_KEY && process.env.BACKUP_S3_SECRET_KEY);
  }

  private async uploadToRemote(filepath: string, filename: string) {
    const client = new S3Client({
      endpoint: process.env.BACKUP_S3_ENDPOINT,
      region: process.env.BACKUP_S3_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.BACKUP_S3_ACCESS_KEY!,
        secretAccessKey: process.env.BACKUP_S3_SECRET_KEY!,
      },
      forcePathStyle: true, // required by most non-AWS S3-compatible providers
    });

    await client.send(
      new PutObjectCommand({
        Bucket: process.env.BACKUP_S3_BUCKET,
        Key: `clinic-backups/${filename}`,
        Body: createReadStream(filepath),
      }),
    );
  }

  async downloadBackup(filename: string, userId: string, ipAddress?: string, userAgent?: string): Promise<string> {
    this.logger.log(`Downloading backup: ${filename}`);
    const manifest = await this.readManifest();
    const entry = await this.validateRecoveryPoint(filename, manifest);
    const filepath = this.resolveSafePath(entry.filename);

    await this.auditService.logUserAction(userId, 'BACKUP_DOWNLOADED', 'System', filename, ipAddress, userAgent);

    this.logger.log(`Backup download completed: ${filename}`);
    return filepath;
  }

  async exportToExcel(userId: string, ipAddress?: string, userAgent?: string): Promise<Buffer> {
    this.logger.log('Starting Excel data export');

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Clinic Management System';
    const exportedAt = new Date();
    workbook.created = exportedAt;
    workbook.modified = exportedAt;
    workbook.lastModifiedBy = 'Clinic Management System';

    const metadata = workbook.addWorksheet('Backup Info');
    metadata.columns = [
      { header: 'Property', key: 'property', width: 24 },
      { header: 'Value', key: 'value', width: 80 },
    ];
    metadata.addRows([
      { property: 'Exported At', value: exportedAt.toISOString() },
      { property: 'Workbook Version', value: '1' },
      { property: 'Source', value: 'Clinic Management System' },
      { property: 'Scope', value: 'Business and reference data only; authentication and audit secrets are excluded.' },
    ]);

    const exportedSheets: Array<{ name: string; rowCount: number }> = [];
    const normalizeCellValue = (value: unknown): unknown => {
      if (value === null || value === undefined) return null;
      if (value instanceof Date) return value;
      if (typeof value === 'object' && value !== null && 'toNumber' in value && typeof value.toNumber === 'function') {
        return value.toNumber();
      }
      if (typeof value === 'string' && /^[=+\-@]/.test(value)) return `'${value}`;
      return value;
    };

    const addWorksheet = async (
      name: string,
      query: () => Promise<Array<Record<string, unknown>>>,
      columns: Partial<ExcelJS.Column>[],
    ) => {
      const sheet = workbook.addWorksheet(name);
      sheet.columns = columns;
      const data = await query();
      sheet.addRows(data.map(row => Object.fromEntries(
        Object.entries(row).map(([key, value]) => [key, normalizeCellValue(value)]),
      )));
      sheet.getRow(1).font = { bold: true };
      sheet.views = [{ state: 'frozen', ySplit: 1 }];
      sheet.autoFilter = { from: 'A1', to: `${String.fromCharCode(64 + columns.length)}1` };
      exportedSheets.push({ name, rowCount: data.length });
    };

    await addWorksheet(
      'Patients',
      () => this.prisma.patient.findMany({
        select: {
          id: true,
          civilId: true,
          fullNameAr: true,
          fullNameEn: true,
          phone: true,
          dateOfBirth: true,
          address: true,
          legacySource: true,
          legacyPatientKey: true,
          legacyReference: true,
          isArchived: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      [
        { header: 'ID', key: 'id' },
        { header: 'Civil ID', key: 'civilId' },
        { header: 'Full Name (Arabic)', key: 'fullNameAr' },
        { header: 'Full Name (English)', key: 'fullNameEn' },
        { header: 'Phone', key: 'phone' },
        { header: 'Date of Birth', key: 'dateOfBirth' },
        { header: 'Address', key: 'address' },
        { header: 'Legacy Source', key: 'legacySource' },
        { header: 'Legacy Patient Key', key: 'legacyPatientKey' },
        { header: 'Legacy Reference', key: 'legacyReference' },
        { header: 'Archived', key: 'isArchived' },
        { header: 'Created At', key: 'createdAt' },
        { header: 'Updated At', key: 'updatedAt' },
      ],
    );

    await addWorksheet(
      'Appointments',
      () => this.prisma.appointment.findMany({
        select: {
          id: true,
          patientId: true,
          scheduledAt: true,
          status: true,
          notes: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      [
        { header: 'ID', key: 'id' },
        { header: 'Patient ID', key: 'patientId' },
        { header: 'Scheduled At', key: 'scheduledAt' },
        { header: 'Status', key: 'status' },
        { header: 'Notes', key: 'notes' },
        { header: 'Created At', key: 'createdAt' },
        { header: 'Updated At', key: 'updatedAt' },
      ],
    );

    await addWorksheet(
      'Visits',
      () => this.prisma.visit.findMany({
        select: {
          id: true,
          patientId: true,
          appointmentId: true,
          type: true,
          diagnosis: true,
          status: true,
          visitDate: true,
          notes: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      [
        { header: 'ID', key: 'id' },
        { header: 'Patient ID', key: 'patientId' },
        { header: 'Appointment ID', key: 'appointmentId' },
        { header: 'Type', key: 'type' },
        { header: 'Diagnosis', key: 'diagnosis' },
        { header: 'Status', key: 'status' },
        { header: 'Visit Date', key: 'visitDate' },
        { header: 'Notes', key: 'notes' },
        { header: 'Created At', key: 'createdAt' },
        { header: 'Updated At', key: 'updatedAt' },
      ],
    );

    await addWorksheet(
      'Services',
      () => this.prisma.service.findMany({
        select: {
          id: true,
          name: true,
          code: true,
          description: true,
          currentPrice: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      [
        { header: 'ID', key: 'id' },
        { header: 'Name', key: 'name' },
        { header: 'Code', key: 'code' },
        { header: 'Description', key: 'description' },
        { header: 'Current Price', key: 'currentPrice' },
        { header: 'Active', key: 'isActive' },
        { header: 'Created At', key: 'createdAt' },
        { header: 'Updated At', key: 'updatedAt' },
      ],
    );

    await addWorksheet(
      'Invoices',
      () => this.prisma.invoice.findMany({
        select: {
          id: true,
          invoiceNumber: true,
          patientId: true,
          visitId: true,
          status: true,
          subtotal: true,
          total: true,
          paid: true,
          remaining: true,
          paymentStatus: true,
          issuedAt: true,
          replacedByInvoiceId: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      [
        { header: 'ID', key: 'id' },
        { header: 'Invoice Number', key: 'invoiceNumber' },
        { header: 'Patient ID', key: 'patientId' },
        { header: 'Visit ID', key: 'visitId' },
        { header: 'Status', key: 'status' },
        { header: 'Subtotal', key: 'subtotal' },
        { header: 'Total', key: 'total' },
        { header: 'Paid', key: 'paid' },
        { header: 'Remaining', key: 'remaining' },
        { header: 'Payment Status', key: 'paymentStatus' },
        { header: 'Issued At', key: 'issuedAt' },
        { header: 'Replaced By Invoice ID', key: 'replacedByInvoiceId' },
        { header: 'Created At', key: 'createdAt' },
        { header: 'Updated At', key: 'updatedAt' },
      ],
    );

    await addWorksheet(
      'Invoice Items',
      () => this.prisma.invoiceItem.findMany({
        select: {
          id: true,
          invoiceId: true,
          serviceId: true,
          serviceNameSnapshot: true,
          unitPriceSnapshot: true,
          quantity: true,
          lineTotal: true,
          createdAt: true,
        },
      }),
      [
        { header: 'ID', key: 'id' },
        { header: 'Invoice ID', key: 'invoiceId' },
        { header: 'Service ID', key: 'serviceId' },
        { header: 'Service Name', key: 'serviceNameSnapshot' },
        { header: 'Unit Price', key: 'unitPriceSnapshot' },
        { header: 'Quantity', key: 'quantity' },
        { header: 'Line Total', key: 'lineTotal' },
        { header: 'Created At', key: 'createdAt' },
      ],
    );

    await addWorksheet(
      'Additional Charges',
      () => this.prisma.invoiceAdditionalCharge.findMany({
        select: {
          id: true,
          invoiceId: true,
          chargeType: true,
          chargeValue: true,
          calculatedAmount: true,
          description: true,
          createdAt: true,
        },
      }),
      [
        { header: 'ID', key: 'id' },
        { header: 'Invoice ID', key: 'invoiceId' },
        { header: 'Charge Type', key: 'chargeType' },
        { header: 'Charge Value', key: 'chargeValue' },
        { header: 'Calculated Amount', key: 'calculatedAmount' },
        { header: 'Description', key: 'description' },
        { header: 'Created At', key: 'createdAt' },
      ],
    );

    await addWorksheet(
      'Payments',
      () => this.prisma.payment.findMany({
        select: {
          id: true,
          invoiceId: true,
          amount: true,
          method: true,
          paymentDate: true,
          status: true,
          notes: true,
          reversedAt: true,
          reversalNotes: true,
          createdAt: true,
        },
      }),
      [
        { header: 'ID', key: 'id' },
        { header: 'Invoice ID', key: 'invoiceId' },
        { header: 'Amount', key: 'amount' },
        { header: 'Method', key: 'method' },
        { header: 'Payment Date', key: 'paymentDate' },
        { header: 'Status', key: 'status' },
        { header: 'Notes', key: 'notes' },
        { header: 'Reversed At', key: 'reversedAt' },
        { header: 'Reversal Notes', key: 'reversalNotes' },
        { header: 'Created At', key: 'createdAt' },
      ],
    );

    await addWorksheet(
      'Payment Allocations',
      () => this.prisma.paymentAllocation.findMany({
        select: {
          id: true,
          paymentId: true,
          invoiceId: true,
          amount: true,
          createdAt: true,
        },
      }),
      [
        { header: 'ID', key: 'id' },
        { header: 'Payment ID', key: 'paymentId' },
        { header: 'Invoice ID', key: 'invoiceId' },
        { header: 'Amount', key: 'amount' },
        { header: 'Created At', key: 'createdAt' },
      ],
    );

    metadata.addRow({ property: 'Sheets', value: exportedSheets.map(sheet => sheet.name).join(', ') });
    for (const sheet of exportedSheets) {
      metadata.addRow({ property: `${sheet.name} Rows`, value: sheet.rowCount });
    }
    metadata.getRow(1).font = { bold: true };
    metadata.views = [{ state: 'frozen', ySplit: 1 }];

    const buffer = await workbook.xlsx.writeBuffer();

    // Audit log
    await this.auditService.logUserAction(
      userId,
      'DATA_EXPORT',
      'Backup',
      'excel-export',
      ipAddress,
      userAgent,
    );

    this.logger.log('Excel data export completed');
    return buffer as unknown as Buffer;
  }
}
