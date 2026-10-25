ALTER TABLE "Invoice"
  ALTER COLUMN "visitId" DROP NOT NULL,
  ALTER COLUMN "patientId" DROP NOT NULL;

ALTER TABLE "Invoice"
  ADD COLUMN "patientNameSnapshot" TEXT,
  ADD COLUMN "isTelephoneConsultation" BOOLEAN NOT NULL DEFAULT false;
