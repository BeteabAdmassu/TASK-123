import { Pool } from 'pg';

export async function createAuditEntry(
  db: Pool,
  entityType: string,
  entityId: string,
  action: string,
  actorId: string,
  beforeState: Record<string, unknown> | null = null,
  afterState: Record<string, unknown> | null = null,
  metadata: Record<string, unknown> | null = null
): Promise<void> {
  await db.query(
    `INSERT INTO audit_trail (entity_type, entity_id, action, actor_id, before_state, after_state, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [entityType, entityId, action, actorId,
     beforeState ? JSON.stringify(beforeState) : null,
     afterState ? JSON.stringify(afterState) : null,
     metadata ? JSON.stringify(metadata) : null]
  );
}
