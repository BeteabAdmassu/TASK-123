import { Pool } from 'pg';

/**
 * Shared object-level authorization for project and posting resources.
 *
 * admin/reviewer: broad access to all projects/postings.
 * recruiter: only projects they created and postings within those projects.
 * approver: only projects/postings linked to candidates they have approval steps for.
 */

export async function checkProjectAccess(
  db: Pool,
  projectId: string,
  userId: string,
  userRole: string
): Promise<{ allowed: boolean; status?: number; message?: string }> {
  if (userRole === 'admin' || userRole === 'reviewer') {
    return { allowed: true };
  }

  if (userRole === 'recruiter') {
    const ownerCheck = await db.query(
      'SELECT 1 FROM recruiting_projects WHERE id = $1 AND created_by = $2 AND archived_at IS NULL',
      [projectId, userId]
    );
    if (ownerCheck.rows.length > 0) return { allowed: true };
  }

  if (userRole === 'approver') {
    // Approver can view projects that contain candidates they are assigned to approve
    const approverCheck = await db.query(
      `SELECT 1 FROM approval_requests ar
       JOIN approval_steps ast ON ast.request_id = ar.id
       JOIN candidates c ON c.id = ar.entity_id AND ar.entity_type = 'candidate'
       JOIN job_postings jp ON jp.id = c.job_posting_id
       WHERE jp.project_id = $1 AND ast.approver_id = $2
       LIMIT 1`,
      [projectId, userId]
    );
    if (approverCheck.rows.length > 0) return { allowed: true };
  }

  return { allowed: false, status: 403, message: 'You do not have access to this project' };
}

export async function checkPostingAccess(
  db: Pool,
  postingId: string,
  userId: string,
  userRole: string
): Promise<{ allowed: boolean; status?: number; message?: string }> {
  if (userRole === 'admin' || userRole === 'reviewer') {
    return { allowed: true };
  }

  // Look up the parent project to delegate to project-level check
  const posting = await db.query(
    'SELECT project_id FROM job_postings WHERE id = $1 AND archived_at IS NULL',
    [postingId]
  );

  if (posting.rows.length === 0) {
    return { allowed: false, status: 404, message: 'Posting not found' };
  }

  return checkProjectAccess(db, posting.rows[0].project_id, userId, userRole);
}
