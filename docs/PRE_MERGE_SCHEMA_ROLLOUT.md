# Schema rollout and recovery notes

The quick appointment and telephone consultation migrations are expand-only for
existing rows: they relax `NOT NULL`, add nullable snapshot fields, add a
`BOOLEAN NOT NULL DEFAULT false`, and add the `TELEPHONE_CONSULTATION` enum
value. They do not delete or rewrite existing business rows. PostgreSQL cannot
drop an enum value with a simple down migration, and nullable feature rows are
not compatible with the previous application's assumptions.

## Deployment order

1. Take a pre-migration backup and verify it is readable. Rehearse the migration
   against an isolated copy containing synthetic data before production rollout.
   This legacy-schema backup is for isolated forward recovery; the new
   application's in-place restore guard will reject it.
2. Run the Prisma migration step separately from the new API rollout, while the
   old API still serves legacy-shaped data. The production API image also runs
   `prisma migrate deploy` before starting NestJS, so its startup migration is a
   no-op after this step and the API will not start if migration deployment
   fails.
3. Validate the migrated schema and existing records, then take and verify a
   post-migration backup containing completed records for every migration in
   the release. Keep this as the first backup accepted by the new application's
   in-place restore guard, and complete this step before allowing feature rows.
4. Start the new API and verify its health and existing patient-linked
   appointment, visit, invoice, payment, and report workflows.
5. Drain all old API instances before making the new appointment and telephone
   consultation flows available in the frontend. Do not let an old API instance
   continue serving after the new API has created rows with nullable patient or
   visit relations, or the new visit enum value.
6. Deploy the frontend only after the new API is healthy, smoke-test the
   appointment and telephone consultation flows, then monitor errors and
   database health during rollout.

## Application and schema compatibility

| Application | Schema | Compatibility |
| --- | --- | --- |
| Old application | Old schema | Supported legacy combination. |
| New application | New schema | Supported target combination. Migrations must be applied before the new API starts. |
| Old application | Expanded schema before feature records exist | Temporarily compatible only while all data remains legacy-shaped; this is a recovery window, not the normal rollout target. Rehearse it against an isolated copy before relying on it. |
| Old application | Expanded schema after quick appointments, telephone consultation visits, or invoices with nullable patient/visit relations exist | Unsafe. The old application assumes required relations and does not understand the new visit enum value. Roll forward with a compatible application instead. |
| New application | Old schema | Unsafe and unsupported. Required nullable columns and the telephone consultation enum value are missing; apply migrations before starting the new API. |

The new migrations are additive for legacy records, but that does not make a
new-schema/old-application rollback safe after feature-specific records have
been written. The deployment process must ensure migrations finish before the
new API starts, and the frontend must not expose the new flows while old API
instances remain active.

The new migrations can be applied before the new API while only legacy-shaped
rows exist. If rollout fails before any new feature rows are written, the old
application can be restored while retaining the expanded schema, subject to a
successful isolated compatibility rehearsal. Once a patient-less appointment,
telephone consultation enum value, or invoice with a nullable patient/visit has
been written, do not roll back to the old application. Recover by rolling
forward with a compatible application release or by using the controlled
recovery procedure below.

## Backup restore and disaster recovery

The in-place restore endpoint accepts backups only when their compressed SQL
contains completed records for every migration in the running application's
Prisma migration directory. It takes the pre-restore safety backup only after
this compatibility check, and keeps the `psql` restore atomic with
`ON_ERROR_STOP` and `--single-transaction`.

A backup from before the feature migrations is intentionally rejected by the
new application: its `--clean` SQL would replace the current schema with the
older schema. Do not bypass the guard or restore that backup directly into the
live database. Restore it into an isolated database, apply and validate the
current forward migrations there, verify records, reports, exports, and
invoices, and only then use the organization's approved database recovery and
traffic-switch procedure. The application does not automatically migrate a
database after restore.

A current backup containing all required migration records can be restored by
the current application. If application rollback is required after new feature
data exists, use a forward-compatible release; restoring an old application
binary is not a safe rollback strategy.

## Date-time API compatibility

Appointment and visit write APIs require an explicit timezone (`Z` or a numeric
offset). The existing web client sends an ISO UTC timestamp ending in `Z`, and
the updated client may send an explicit Kuwait offset; both preserve the same
instant. A timezone-less timestamp remains rejected because its intended zone
cannot be inferred safely. External API clients must send an explicit offset
before upgrading.
