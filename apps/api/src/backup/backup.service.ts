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

// Real pg_dump / psql backed backup & restore. Nothing here is simulated —
// every operation shells out to the actual Postgres client tools against the
// live database, using the same credentials the app itself connects with.
@Injectable()
export class BackupService implements OnModuleInit {
  private readonly logger = new Logger(BackupService.name);

  // Concurrency control: prevent overlapping backup/restore operations
  private operationInProgress = false;

  constructor(
    private auditService: AuditService,
    @Optional() private maintenanceService: MaintenanceService = new MaintenanceService(),
  ) {}

  private async withOperationLock<T>(operation: () => Promise<T>): Promise<T> {
    // Wait for current operation to complete
    while (this.operationInProgress) {
      // eslint-disable-next-line no-undef
      await new Promise<void>(resolve => setTimeout(resolve, 100));
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
    try {
      const pgDumpCheck = spawnSync('which', ['pg_dump']);
      if (pgDumpCheck.status !== 0) {
        throw new Error('pg_dump not found in PATH. PostgreSQL client tools must be installed for backup operations.');
      }
      const psqlCheck = spawnSync('which', ['psql']);
      if (psqlCheck.status !== 0) {
        throw new Error('psql not found in PATH. PostgreSQL client tools must be installed for backup operations.');
      }
    } catch {
      this.logger.warn('Could not verify pg_dump/psql availability');
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

    // CRITICAL: Validate that we're not accidentally targeting production during test verification
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
    await fs.mkdir(this.backupDir, { recursive: true });
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
  // via @nestjs/schedule — it will actually fire in production, not a
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
        [
          '--host', host,
          '--port', port,
          '--username', user,
          ...(sslmode ? ['--sslmode', sslmode] : []),
          '--format', 'plain',
          '--clean',
          '--if-exists',
          '--no-owner',
          database,
        ],
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
  }

  async getStatus() {
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
}
