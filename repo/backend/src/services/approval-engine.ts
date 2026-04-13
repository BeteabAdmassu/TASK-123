import { Pool } from 'pg';
import { createAuditEntry } from './audit.service';
import { createNotification } from './notification.service';

export async function processApprovalDecision(
  db: Pool,
  requestId: string,
  stepId: string,
  approverUserId: string,
  decision: 'approved' | 'rejected',
  comment: string | null,
  attachmentPath: string | null = null,
  attachmentSize: number | null = null
): Promise<{ requestStatus: string; completed: boolean }> {
  // Validate the step belongs to the request and is assigned to this approver
  const stepResult = await db.query(
    `SELECT s.*, r.approval_mode, r.status as request_status, r.entity_type, r.entity_id, r.final_write_back, r.requested_by
     FROM approval_steps s
     JOIN approval_requests r ON r.id = s.request_id
     WHERE s.id = $1 AND s.request_id = $2`,
    [stepId, requestId]
  );

  if (stepResult.rows.length === 0) {
    throw { statusCode: 404, message: 'Approval step not found' };
  }

  const step = stepResult.rows[0];

  if (step.approver_id !== approverUserId) {
    throw { statusCode: 403, message: 'You are not assigned to this approval step' };
  }

  if (step.status !== 'pending') {
    throw { statusCode: 400, message: 'This step has already been decided' };
  }

  if (step.request_status !== 'pending') {
    throw { statusCode: 400, message: 'This approval request is no longer pending' };
  }

  if (decision === 'rejected' && !comment) {
    throw { statusCode: 400, message: 'Comment is required for rejection' };
  }

  // Update the step
  await db.query(
    `UPDATE approval_steps SET status = $1, comment = $2, attachment_path = $3, attachment_size = $4, decided_at = NOW()
     WHERE id = $5`,
    [decision, comment, attachmentPath, attachmentSize, stepId]
  );

  // Audit the decision
  await createAuditEntry(db, 'approval_step', stepId, `step_${decision}`, approverUserId, null, {
    decision, comment, requestId
  });

  // Determine if the overall request is resolved
  let requestStatus = 'pending';
  let completed = false;

  if (decision === 'rejected') {
    // Any rejection => request rejected
    requestStatus = 'rejected';
    completed = true;
  } else if (step.approval_mode === 'any') {
    // Any-sign: first approval completes the request
    requestStatus = 'approved';
    completed = true;
  } else {
    // Joint-sign: check if ALL steps for this request are approved
    const pendingSteps = await db.query(
      `SELECT COUNT(*) as count FROM approval_steps
       WHERE request_id = $1 AND status = 'pending'`,
      [requestId]
    );
    if (parseInt(pendingSteps.rows[0].count) === 0) {
      requestStatus = 'approved';
      completed = true;
    }
  }

  if (completed) {
    await db.query(
      'UPDATE approval_requests SET status = $1, updated_at = NOW() WHERE id = $2',
      [requestStatus, requestId]
    );

    // Audit request completion
    await createAuditEntry(db, 'approval_request', requestId, `request_${requestStatus}`, approverUserId);

    // If approved and write-back exists, apply it
    if (requestStatus === 'approved' && step.final_write_back) {
      await applyWriteBack(db, step.entity_type, step.entity_id, step.final_write_back, approverUserId);
    }

    // If it's a credit_change, update the credit change status
    if (step.entity_type === 'credit_change') {
      await db.query(
        'UPDATE credit_changes SET status = $1, updated_at = NOW() WHERE id = $2',
        [requestStatus === 'approved' ? 'approved' : 'rejected', step.entity_id]
      );
    }

    // Notify the requester
    try {
      await createNotification(db, step.requested_by, 'approval_completed', {
        decision: requestStatus,
        entity_type: step.entity_type,
        entity_id: step.entity_id,
      });
    } catch {
      // Non-critical, don't fail the approval
    }
  }

  return { requestStatus, completed };
}

async function applyWriteBack(
  db: Pool,
  entityType: string,
  entityId: string,
  writeBack: Record<string, unknown>,
  actorId: string
): Promise<void> {
  const tableMap: Record<string, string> = {
    candidate: 'candidates',
    service_spec: 'service_specifications',
    credit_change: 'credit_changes',
  };

  const table = tableMap[entityType];
  if (!table || !writeBack) return;

  const fields = Object.keys(writeBack);
  if (fields.length === 0) return;

  const setClauses = fields.map((f, i) => `${f} = $${i + 1}`);
  const values = fields.map(f => writeBack[f]);

  await db.query(
    `UPDATE ${table} SET ${setClauses.join(', ')}, updated_at = NOW() WHERE id = $${fields.length + 1}`,
    [...values, entityId]
  );

  await createAuditEntry(db, entityType, entityId, 'write_back_applied', actorId, null, writeBack);
}
