-- AlterEnum
ALTER TYPE "PaymentMethod" RENAME TO "PaymentMethod_old";

CREATE TYPE "PaymentMethod" AS ENUM ('KNET', 'LINK');

ALTER TABLE "Payment"
  ALTER COLUMN "method"
  TYPE "PaymentMethod"
  USING "method"::text::"PaymentMethod";

DROP TYPE "PaymentMethod_old";
