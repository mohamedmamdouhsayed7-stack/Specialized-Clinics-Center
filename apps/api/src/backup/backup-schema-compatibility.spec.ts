import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { gzipSync } from 'zlib';
import { assertBackupContainsMigrations } from './backup-schema-compatibility';

describe('backup schema compatibility validation', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(`${tmpdir()}/clinic-backup-schema-`);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  async function writeDump(sql: string) {
    const path = `${directory}/snapshot.sql.gz`;
    await writeFile(path, gzipSync(Buffer.from(sql)));
    return path;
  }

  function migrationCopy(rows: string[]) {
    return [
      'COPY public."_prisma_migrations" ("id", "finished_at", "migration_name", "rolled_back_at") FROM stdin;',
      ...rows,
      '\\.',
    ].join('\n');
  }

  it('accepts a backup containing all required completed migrations', async () => {
    const path = await writeDump(migrationCopy([
      '00000000-0000-4000-8000-000000000001\t2026-10-22 00:00:00+00\t20261022090000_support_quick_appointments_and_telephone_consultations\t\\N',
      '00000000-0000-4000-8000-000000000002\t2026-10-23 00:00:00+00\t20261023120000_support_manual_telephone_consultations\t\\N',
    ]));

    await expect(assertBackupContainsMigrations(path, [
      '20261022090000_support_quick_appointments_and_telephone_consultations',
      '20261023120000_support_manual_telephone_consultations',
    ])).resolves.toBeUndefined();
  });

  it('rejects an older backup before restore when required feature migrations are absent', async () => {
    const path = await writeDump(migrationCopy([
      '00000000-0000-4000-8000-000000000001\t2026-09-23 00:00:00+00\t20260923060000_make_audit_entity_id_text\t\\N',
    ]));

    await expect(assertBackupContainsMigrations(path, [
      '20260923060000_make_audit_entity_id_text',
      '20261022090000_support_quick_appointments_and_telephone_consultations',
    ])).rejects.toThrow(/older than this application/i);
  });

  it('does not count failed or rolled-back migration records as applied', async () => {
    const path = await writeDump(migrationCopy([
      '00000000-0000-4000-8000-000000000001\t\\N\t20261022090000_support_quick_appointments_and_telephone_consultations\t\\N',
      '00000000-0000-4000-8000-000000000002\t2026-10-23 00:00:00+00\t20261023120000_support_manual_telephone_consultations\t2026-10-24 00:00:00+00',
    ]));

    await expect(assertBackupContainsMigrations(path, [
      '20261022090000_support_quick_appointments_and_telephone_consultations',
      '20261023120000_support_manual_telephone_consultations',
    ])).rejects.toThrow(/Missing required migrations/i);
  });

  it('rejects a dump with no verifiable Prisma migration history', async () => {
    const path = await writeDump('CREATE TABLE public.legacy_data (id integer);\n');

    await expect(assertBackupContainsMigrations(path, ['20261023120000_support_manual_telephone_consultations']))
      .rejects.toThrow(/does not contain verifiable Prisma migration history/i);
  });
});
