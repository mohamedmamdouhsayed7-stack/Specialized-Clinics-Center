-- Audit events may reference UUID entities as well as filenames and system operations.
ALTER TABLE "AuditLog"
  ALTER COLUMN "entityId" TYPE TEXT
  USING "entityId"::text;
