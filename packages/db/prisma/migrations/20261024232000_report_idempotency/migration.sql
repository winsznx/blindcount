-- Report generation honours its Idempotency-Key (one report per key per organization).
ALTER TABLE "reports" ADD COLUMN "idempotency_key" TEXT;
CREATE UNIQUE INDEX "reports_organization_id_idempotency_key_key" ON "reports"("organization_id", "idempotency_key");
