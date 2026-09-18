-- Update PaymentMethod enum while preserving historical payment methods
-- New payments are restricted at the application/API level.

ALTER TYPE "PaymentMethod" RENAME TO "PaymentMethod_old";

CREATE TYPE "PaymentMethod" AS ENUM (
  'CASH',
  'VISA',
  'KNET',
  'LINK',
  'OTHER'
);

ALTER TABLE "Payment"
  ALTER COLUMN "method"
  TYPE "PaymentMethod"
  USING "method"::text::"PaymentMethod";

DROP TYPE "PaymentMethod_old";
