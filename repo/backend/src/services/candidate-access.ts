import { Pool } from 'pg';

/**
 * Shared object-level authorization for candidate resources.
 * Used by candidates, resumes, attachments, and any route that accesses
 * data scoped to a candidate.
 *
 * admin/reviewer: broad access to all candidates.
 * recruiter: only candidates in postings under projects they own.
 * approver: only candidates with an approval step assigned to them.
 */
export async function checkCandidateAccess(
  db: Pool,
  candidateId: string,
  userId: string,
  userRole: string
): Promise<{ allowed: boolean; status?: number; message?: string }> {
  if (userRole === 'admin' || userRole === 'reviewer') {
    return { allowed: true };
  }

  if (userRole === 'recruiter') {
    const ownerCheck = await db.query(
      `SELECT 1 FROM candidates c
       JOIN job_postings jp ON jp.id = c.job_posting_id
       JOIN recruiting_projects rp ON rp.id = jp.project_id
       WHERE c.id = $1 AND rp.created_by = $2`,
      [candidateId, userId]
    );
    if (ownerCheck.rows.length > 0) return { allowed: true };
  }

  if (userRole === 'approver') {
    const approverCheck = await db.query(
      `SELECT 1 FROM approval_requests ar
       JOIN approval_steps ast ON ast.request_id = ar.id
       WHERE ar.entity_type = 'candidate' AND ar.entity_id = $1 AND ast.approver_id = $2
       LIMIT 1`,
      [candidateId, userId]
    );
    if (approverCheck.rows.length > 0) return { allowed: true };
  }

  return { allowed: false, status: 403, message: 'You do not have access to this candidate\'s resources' };
}
