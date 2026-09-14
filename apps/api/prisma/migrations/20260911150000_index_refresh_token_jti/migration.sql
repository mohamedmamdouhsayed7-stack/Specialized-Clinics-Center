-- Add a lookup key for refresh-token rotation without storing the raw token.
ALTER TABLE "RefreshToken" ADD COLUMN "jti" TEXT;

CREATE UNIQUE INDEX "RefreshToken_jti_key" ON "RefreshToken"("jti");
