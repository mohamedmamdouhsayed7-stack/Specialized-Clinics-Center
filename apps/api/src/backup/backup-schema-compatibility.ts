import { BadRequestException } from '@nestjs/common';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import { createGunzip } from 'zlib';

const MIGRATIONS_COPY_HEADER = /^COPY\s+(?:(?:"public"|public)\.)?(?:"_prisma_migrations"|_prisma_migrations)\s*\(([^)]*)\)\s+FROM\s+stdin;$/i;

/**
 * Refuse an in-place restore unless the compressed pg_dump contains every
 * migration required by this application. The restore pipeline uses one
 * transaction, but preflight keeps an old schema from replacing the live one
 * and then returning the application to service against missing columns/enums.
 */
export async function assertBackupContainsMigrations(
  compressedSqlPath: string,
  requiredMigrations: readonly string[],
): Promise<void> {
  const appliedMigrations = new Set<string>();
  let migrationsTableFound = false;
  let inMigrationsCopy = false;
  let migrationNameIndex = -1;
  let finishedAtIndex = -1;
  let rolledBackAtIndex = -1;
  let rowCount = 0;

  try {
    const gunzip = createReadStream(compressedSqlPath).pipe(createGunzip());
    const lines = createInterface({ input: gunzip, crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        if (!inMigrationsCopy) {
          const header = line.trim().match(MIGRATIONS_COPY_HEADER);
          if (!header) continue;
          if (migrationsTableFound) {
            throw new Error('Backup has duplicate Prisma migration data blocks');
          }
          migrationsTableFound = true;
          const columns = header[1].split(',').map((column) => column.trim().replace(/^"|"$/g, ''));
          migrationNameIndex = columns.indexOf('migration_name');
          finishedAtIndex = columns.indexOf('finished_at');
          rolledBackAtIndex = columns.indexOf('rolled_back_at');
          if (migrationNameIndex < 0 || finishedAtIndex < 0 || rolledBackAtIndex < 0) {
            throw new Error('Backup Prisma migration table is missing required columns');
          }
          inMigrationsCopy = true;
          continue;
        }

        if (line === '\\.') {
          inMigrationsCopy = false;
          continue;
        }

        const fields = line.split('\t');
        if (fields.length <= Math.max(migrationNameIndex, finishedAtIndex, rolledBackAtIndex)) {
          throw new Error('Backup Prisma migration data is malformed');
        }
        rowCount += 1;
        const migrationName = fields[migrationNameIndex];
        const finishedAt = fields[finishedAtIndex];
        const rolledBackAt = fields[rolledBackAtIndex];
        if (migrationName && finishedAt !== '\\N' && rolledBackAt === '\\N') {
          appliedMigrations.add(migrationName);
        }
      }
    } finally {
      lines.close();
      gunzip.destroy();
    }
  } catch {
    throw new BadRequestException('Backup schema history could not be validated; the database was not changed.');
  }

  if (!migrationsTableFound || inMigrationsCopy || rowCount === 0) {
    throw new BadRequestException('Backup does not contain verifiable Prisma migration history; the database was not changed.');
  }

  const missingMigrations = requiredMigrations.filter((migration) => !appliedMigrations.has(migration));
  if (missingMigrations.length > 0) {
    throw new BadRequestException(
      `Backup schema is older than this application. Missing required migrations: ${missingMigrations.join(', ')}. ` +
      'Restore it into an isolated database and migrate and validate it before using it with this application.',
    );
  }
}
