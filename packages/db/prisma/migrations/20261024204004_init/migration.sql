-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'MANAGER', 'AUDITOR', 'REVIEWER', 'CUSTODIAN');

-- CreateEnum
CREATE TYPE "CohortState" AS ENUM ('DRAFT', 'PUBLISH_PENDING', 'PUBLISH_FAILED', 'ACTIVE', 'CLOSING_PENDING', 'CLOSED', 'DISCLOSED', 'ARCHIVED', 'CANCELLED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'RECEIVED', 'ANCHOR_PENDING', 'ANCHOR_FAILED', 'SEALED', 'REVIEW_PENDING', 'APPROVED', 'DISPUTED', 'AMENDMENT_REQUESTED', 'VOID_PENDING', 'VOIDED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AnchorStatus" AS ENUM ('PENDING', 'SUBMITTED', 'CONFIRMED', 'FAILED');

-- CreateEnum
CREATE TYPE "JobState" AS ENUM ('QUEUED', 'RUNNING', 'SUBMITTED', 'DONE', 'FAILED', 'DEAD');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "email_verified_at" TIMESTAMPTZ,
    "display_name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "last_login_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_codes" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reauthed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "country_code" TEXT NOT NULL,
    "time_zone" TEXT NOT NULL,
    "data_policy_version" TEXT NOT NULL DEFAULT 'p0-2026-10',
    "retention_days" INTEGER NOT NULL DEFAULT 365,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "roles" "Role"[],
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "auth_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "roles" "Role"[],
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "accepted_at" TIMESTAMPTZ,
    "revoked_at" TIMESTAMPTZ,
    "invited_by" UUID NOT NULL,
    "delivery_status" TEXT NOT NULL DEFAULT 'QUEUED',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_keys" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "device_label" TEXT NOT NULL,
    "public_jwk" JSONB NOT NULL,
    "jwk_thumbprint" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL DEFAULT 'ES256',
    "attestation_level" TEXT NOT NULL DEFAULT 'software_webcrypto',
    "enrolled_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ,

    CONSTRAINT "device_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "programmes" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "crop" TEXT NOT NULL,
    "region_label" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "start_at" TIMESTAMPTZ NOT NULL,
    "end_at" TIMESTAMPTZ NOT NULL,
    "retention_days" INTEGER NOT NULL DEFAULT 365,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "data_source" TEXT NOT NULL DEFAULT 'SIMULATED_DEMO',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "programmes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cohorts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "programme_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "state" "CohortState" NOT NULL DEFAULT 'DRAFT',
    "due_at" TIMESTAMPTZ NOT NULL,
    "closing_after" TIMESTAMPTZ,
    "chain_campaign_key" TEXT NOT NULL,
    "cohort_nonce" TEXT NOT NULL,
    "target_commitment" TEXT,
    "expected_count" INTEGER NOT NULL DEFAULT 0,
    "roster_frozen_at" TIMESTAMPTZ,
    "published_at" TIMESTAMPTZ,
    "closed_at" TIMESTAMPTZ,
    "disclosed_at" TIMESTAMPTZ,
    "publish_tx_hashes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "close_tx_hash" TEXT,
    "disclosure_tx_hash" TEXT,
    "last_error" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "cohorts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "criteria_versions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "cohort_id" UUID NOT NULL,
    "schema_version" TEXT NOT NULL DEFAULT 'blindcount.criterion.v1',
    "operator" TEXT NOT NULL DEFAULT 'gte',
    "unit" TEXT NOT NULL DEFAULT 'shade_trees',
    "target_ciphertext" TEXT NOT NULL,
    "target_salt_ciphertext" TEXT NOT NULL,
    "key_ref" TEXT NOT NULL,
    "canonical_target_hash_ciphertext" TEXT NOT NULL,
    "commitment" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "locked_at" TIMESTAMPTZ,
    "revealed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "criteria_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "farms" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "programme_id" UUID NOT NULL,
    "external_code" TEXT NOT NULL,
    "display_pseudonym" TEXT NOT NULL,
    "coarse_region" TEXT,
    "consent_reference" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "farms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "cohort_id" UUID NOT NULL,
    "farm_id" UUID NOT NULL,
    "auditor_user_id" UUID NOT NULL,
    "assignment_key" TEXT NOT NULL,
    "key_nonce" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'PENDING',
    "due_at" TIMESTAMPTZ NOT NULL,
    "published_at" TIMESTAMPTZ,
    "last_synced_at" TIMESTAMPTZ,
    "void_reason" TEXT,
    "void_tx_hash" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignment_approvals" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "approver_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "decided_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assignment_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "observations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "current_approved_version_id" UUID,
    "review_status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submission_versions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "observation_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "previous_version_id" UUID,
    "idempotency_key" TEXT NOT NULL,
    "payload_json_encrypted" TEXT NOT NULL,
    "payload_sha256" TEXT NOT NULL,
    "observed_count" INTEGER NOT NULL,
    "commitment" TEXT NOT NULL,
    "commitment_salt_encrypted" TEXT NOT NULL,
    "client_nonce" TEXT NOT NULL,
    "device_signature" TEXT NOT NULL,
    "signature_format" TEXT NOT NULL,
    "device_key_id" UUID NOT NULL,
    "device_claimed_at" TIMESTAMPTZ NOT NULL,
    "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receipt_signature" TEXT NOT NULL,
    "anchor_status" "AnchorStatus" NOT NULL DEFAULT 'PENDING',
    "anchor_tx_hash" TEXT,
    "anchor_block_number" BIGINT,
    "anchor_block_hash" TEXT,
    "anchor_confirmed_at" TIMESTAMPTZ,
    "reason" TEXT,
    "amendment_status" TEXT,

    CONSTRAINT "submission_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_files" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "uploaded_by" UUID NOT NULL,
    "submission_version_id" UUID,
    "storage_key" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "capture_claimed_at" TIMESTAMPTZ,
    "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consent_flag" BOOLEAN NOT NULL,
    "processing_state" TEXT NOT NULL DEFAULT 'VALIDATED',

    CONSTRAINT "evidence_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "anchor_jobs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "event_key" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "state" "JobState" NOT NULL DEFAULT 'QUEUED',
    "tx_hash" TEXT,
    "last_error_code" TEXT,
    "next_retry_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_until" TIMESTAMPTZ,
    "finalized_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "anchor_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chain_events" (
    "id" UUID NOT NULL,
    "chain_id" INTEGER NOT NULL,
    "contract_address" TEXT NOT NULL,
    "tx_hash" TEXT NOT NULL,
    "log_index" INTEGER NOT NULL,
    "block_hash" TEXT NOT NULL,
    "block_number" BIGINT NOT NULL,
    "event_name" TEXT NOT NULL,
    "event_payload" JSONB NOT NULL,
    "canonical" BOOLEAN NOT NULL DEFAULT true,
    "recorded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chain_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_cases" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "observation_id" UUID NOT NULL,
    "assigned_reviewer_id" UUID,
    "state" TEXT NOT NULL DEFAULT 'OPEN',
    "discrepancy_type" TEXT,
    "decision" TEXT,
    "decision_reason" TEXT,
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_actions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "review_case_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "action_type" TEXT NOT NULL,
    "notes" TEXT,
    "prior_state" TEXT,
    "new_state" TEXT,
    "linked_submission_id" UUID,
    "flag_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_assessments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "submission_version_id" UUID NOT NULL,
    "model_provider" TEXT NOT NULL,
    "model_name" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "result_schema_version" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "flags_json" JSONB,
    "input_digest" TEXT NOT NULL,
    "latency_ms" INTEGER,
    "error_code" TEXT,
    "human_label" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "observation_id" UUID NOT NULL,
    "criterion_version_id" UUID NOT NULL,
    "submission_version_id" UUID NOT NULL,
    "comparison_operator" TEXT NOT NULL,
    "observed_count" INTEGER NOT NULL,
    "target_count" INTEGER NOT NULL,
    "result" TEXT NOT NULL,
    "rule_version" TEXT NOT NULL,
    "result_digest" TEXT NOT NULL,
    "evaluated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "observation_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "manifest_sha256" TEXT NOT NULL,
    "pdf_storage_key" TEXT NOT NULL,
    "csv_storage_key" TEXT NOT NULL,
    "packet_storage_key" TEXT NOT NULL,
    "generated_by" UUID NOT NULL,
    "generated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_at" TIMESTAMPTZ,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "share_grants" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "report_id" UUID NOT NULL,
    "recipient_hint" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "download_limit" INTEGER NOT NULL,
    "downloads_used" INTEGER NOT NULL DEFAULT 0,
    "revoked_at" TIMESTAMPTZ,
    "granted_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "share_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "actor_id" UUID,
    "actor_type" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "object_type" TEXT NOT NULL,
    "object_id" TEXT,
    "trace_id" TEXT NOT NULL,
    "metadata_redacted" JSONB NOT NULL DEFAULT '{}',
    "recorded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_alerts" (
    "id" UUID NOT NULL,
    "severity" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "source_id" TEXT,
    "state" TEXT NOT NULL DEFAULT 'OPEN',
    "first_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ,
    "context_redacted" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "system_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "login_codes_email_created_at_idx" ON "login_codes"("email", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_expires_at_idx" ON "sessions"("user_id", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_organization_id_user_id_key" ON "memberships"("organization_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations"("token_hash");

-- CreateIndex
CREATE INDEX "invitations_organization_id_email_idx" ON "invitations"("organization_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "device_keys_jwk_thumbprint_key" ON "device_keys"("jwk_thumbprint");

-- CreateIndex
CREATE INDEX "device_keys_organization_id_user_id_idx" ON "device_keys"("organization_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "programmes_organization_id_code_key" ON "programmes"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "cohorts_chain_campaign_key_key" ON "cohorts"("chain_campaign_key");

-- CreateIndex
CREATE INDEX "cohorts_organization_id_state_idx" ON "cohorts"("organization_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX "cohorts_programme_id_code_key" ON "cohorts"("programme_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "criteria_versions_cohort_id_key" ON "criteria_versions"("cohort_id");

-- CreateIndex
CREATE UNIQUE INDEX "farms_programme_id_external_code_key" ON "farms"("programme_id", "external_code");

-- CreateIndex
CREATE UNIQUE INDEX "assignments_assignment_key_key" ON "assignments"("assignment_key");

-- CreateIndex
CREATE INDEX "assignments_organization_id_auditor_user_id_idx" ON "assignments"("organization_id", "auditor_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "assignments_cohort_id_farm_id_key" ON "assignments"("cohort_id", "farm_id");

-- CreateIndex
CREATE UNIQUE INDEX "assignments_cohort_id_code_key" ON "assignments"("cohort_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "assignment_approvals_assignment_id_action_approver_id_key" ON "assignment_approvals"("assignment_id", "action", "approver_id");

-- CreateIndex
CREATE UNIQUE INDEX "observations_assignment_id_key" ON "observations"("assignment_id");

-- CreateIndex
CREATE UNIQUE INDEX "submission_versions_client_nonce_key" ON "submission_versions"("client_nonce");

-- CreateIndex
CREATE UNIQUE INDEX "submission_versions_observation_id_version_number_key" ON "submission_versions"("observation_id", "version_number");

-- CreateIndex
CREATE UNIQUE INDEX "submission_versions_organization_id_idempotency_key_key" ON "submission_versions"("organization_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_files_storage_key_key" ON "evidence_files"("storage_key");

-- CreateIndex
CREATE INDEX "evidence_files_sha256_idx" ON "evidence_files"("sha256");

-- CreateIndex
CREATE INDEX "evidence_files_assignment_id_idx" ON "evidence_files"("assignment_id");

-- CreateIndex
CREATE UNIQUE INDEX "anchor_jobs_event_key_key" ON "anchor_jobs"("event_key");

-- CreateIndex
CREATE INDEX "anchor_jobs_state_next_retry_at_idx" ON "anchor_jobs"("state", "next_retry_at");

-- CreateIndex
CREATE UNIQUE INDEX "chain_events_chain_id_contract_address_tx_hash_log_index_key" ON "chain_events"("chain_id", "contract_address", "tx_hash", "log_index");

-- CreateIndex
CREATE INDEX "review_cases_observation_id_idx" ON "review_cases"("observation_id");

-- CreateIndex
CREATE INDEX "review_actions_review_case_id_created_at_idx" ON "review_actions"("review_case_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_assessments_submission_version_id_idx" ON "ai_assessments"("submission_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "evaluations_observation_id_submission_version_id_key" ON "evaluations"("observation_id", "submission_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "reports_observation_id_version_key" ON "reports"("observation_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "share_grants_token_hash_key" ON "share_grants"("token_hash");

-- CreateIndex
CREATE INDEX "audit_events_organization_id_recorded_at_idx" ON "audit_events"("organization_id", "recorded_at");

-- CreateIndex
CREATE INDEX "system_alerts_severity_state_idx" ON "system_alerts"("severity", "state");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_keys" ADD CONSTRAINT "device_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programmes" ADD CONSTRAINT "programmes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cohorts" ADD CONSTRAINT "cohorts_programme_id_fkey" FOREIGN KEY ("programme_id") REFERENCES "programmes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "criteria_versions" ADD CONSTRAINT "criteria_versions_cohort_id_fkey" FOREIGN KEY ("cohort_id") REFERENCES "cohorts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "farms" ADD CONSTRAINT "farms_programme_id_fkey" FOREIGN KEY ("programme_id") REFERENCES "programmes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_cohort_id_fkey" FOREIGN KEY ("cohort_id") REFERENCES "cohorts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_farm_id_fkey" FOREIGN KEY ("farm_id") REFERENCES "farms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_approvals" ADD CONSTRAINT "assignment_approvals_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observations" ADD CONSTRAINT "observations_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_versions" ADD CONSTRAINT "submission_versions_observation_id_fkey" FOREIGN KEY ("observation_id") REFERENCES "observations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_files" ADD CONSTRAINT "evidence_files_submission_version_id_fkey" FOREIGN KEY ("submission_version_id") REFERENCES "submission_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_cases" ADD CONSTRAINT "review_cases_observation_id_fkey" FOREIGN KEY ("observation_id") REFERENCES "observations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_actions" ADD CONSTRAINT "review_actions_review_case_id_fkey" FOREIGN KEY ("review_case_id") REFERENCES "review_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_observation_id_fkey" FOREIGN KEY ("observation_id") REFERENCES "observations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_observation_id_fkey" FOREIGN KEY ("observation_id") REFERENCES "observations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_grants" ADD CONSTRAINT "share_grants_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- BlindCount integrity guards (INV-04, INV-05, PRD 9.3)
ALTER TABLE "submission_versions" ADD CONSTRAINT "observed_count_range" CHECK ("observed_count" >= 0 AND "observed_count" <= 100000);
ALTER TABLE "submission_versions" ADD CONSTRAINT "version_positive" CHECK ("version_number" >= 1);
ALTER TABLE "evidence_files" ADD CONSTRAINT "byte_size_positive" CHECK ("byte_size" > 0);

CREATE FUNCTION blindcount_submission_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'SEALED_RECORD_IMMUTABLE: submission versions cannot be deleted';
  END IF;
  IF NEW.payload_json_encrypted IS DISTINCT FROM OLD.payload_json_encrypted
     OR NEW.payload_sha256 IS DISTINCT FROM OLD.payload_sha256
     OR NEW.observed_count IS DISTINCT FROM OLD.observed_count
     OR NEW.commitment IS DISTINCT FROM OLD.commitment
     OR NEW.commitment_salt_encrypted IS DISTINCT FROM OLD.commitment_salt_encrypted
     OR NEW.device_signature IS DISTINCT FROM OLD.device_signature
     OR NEW.device_key_id IS DISTINCT FROM OLD.device_key_id
     OR NEW.version_number IS DISTINCT FROM OLD.version_number
     OR NEW.observation_id IS DISTINCT FROM OLD.observation_id
     OR NEW.received_at IS DISTINCT FROM OLD.received_at
     OR NEW.client_nonce IS DISTINCT FROM OLD.client_nonce THEN
    RAISE EXCEPTION 'SEALED_RECORD_IMMUTABLE: submission content is append-only';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER submission_versions_append_only
  BEFORE UPDATE OR DELETE ON "submission_versions"
  FOR EACH ROW EXECUTE FUNCTION blindcount_submission_append_only();

CREATE FUNCTION blindcount_criterion_locked() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'COHORT_LOCKED: locked criterion cannot be deleted';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.locked_at IS NOT NULL AND (
       NEW.target_ciphertext IS DISTINCT FROM OLD.target_ciphertext
    OR NEW.target_salt_ciphertext IS DISTINCT FROM OLD.target_salt_ciphertext
    OR NEW.commitment IS DISTINCT FROM OLD.commitment
    OR NEW.canonical_target_hash_ciphertext IS DISTINCT FROM OLD.canonical_target_hash_ciphertext
    OR NEW.operator IS DISTINCT FROM OLD.operator
    OR NEW.locked_at IS DISTINCT FROM OLD.locked_at) THEN
    RAISE EXCEPTION 'COHORT_LOCKED: criterion is locked after publish';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER criteria_versions_locked
  BEFORE UPDATE OR DELETE ON "criteria_versions"
  FOR EACH ROW EXECUTE FUNCTION blindcount_criterion_locked();

CREATE FUNCTION blindcount_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'APPEND_ONLY: % rows cannot be modified', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON "audit_events" FOR EACH ROW EXECUTE FUNCTION blindcount_append_only();
CREATE TRIGGER review_actions_append_only BEFORE UPDATE OR DELETE ON "review_actions" FOR EACH ROW EXECUTE FUNCTION blindcount_append_only();
