-- DropIndex
DROP INDEX "assignment_approvals_assignment_id_action_approver_id_key";

-- CreateIndex
CREATE INDEX "assignment_approvals_assignment_id_action_decided_at_idx" ON "assignment_approvals"("assignment_id", "action", "decided_at");
