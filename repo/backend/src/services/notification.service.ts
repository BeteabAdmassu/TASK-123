import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';

export async function createNotification(
  db: Pool,
  recipientId: string,
  templateKey: string,
  vars: Record<string, unknown>
): Promise<string> {
  // Fetch template
  const tplResult = await db.query(
    'SELECT * FROM notification_templates WHERE template_key = $1 AND is_active = true',
    [templateKey]
  );

  const channel = tplResult.rows.length > 0 ? tplResult.rows[0].channel : 'in_app';

  // Render template
  let renderedContent = '';
  if (tplResult.rows.length > 0) {
    const tpl = tplResult.rows[0];
    renderedContent = renderTemplate(tpl.body, vars);
  } else {
    renderedContent = `Notification: ${templateKey} - ${JSON.stringify(vars)}`;
  }

  const result = await db.query(
    `INSERT INTO notification_tasks (recipient_id, type, template_key, template_vars, rendered_content, status)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [recipientId, channel, templateKey, JSON.stringify(vars), renderedContent, channel === 'in_app' ? 'generated' : 'pending']
  );

  return result.rows[0].id;
}

function renderTemplate(template: string, vars: Record<string, unknown>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(value ?? ''));
  }
  return result;
}

export async function generateExportFile(
  db: Pool,
  notificationId: string
): Promise<string> {
  const result = await db.query(
    `SELECT nt.*, ntpl.subject
     FROM notification_tasks nt
     LEFT JOIN notification_templates ntpl ON ntpl.template_key = nt.template_key
     WHERE nt.id = $1`,
    [notificationId]
  );

  if (result.rows.length === 0) {
    throw { statusCode: 404, message: 'Notification not found' };
  }

  const notification = result.rows[0];
  const exportDir = config.notification.exportDir;

  if (!fs.existsSync(exportDir)) {
    fs.mkdirSync(exportDir, { recursive: true });
  }

  const fileName = `${notification.type}_${notificationId}_${Date.now()}.txt`;
  const filePath = path.join(exportDir, fileName);

  const content = [
    `Type: ${notification.type}`,
    `Subject: ${notification.subject || notification.template_key}`,
    `Recipient ID: ${notification.recipient_id}`,
    `Date: ${new Date().toISOString()}`,
    '---',
    notification.rendered_content || renderTemplate(notification.body || '', notification.template_vars),
  ].join('\n');

  fs.writeFileSync(filePath, content, 'utf8');

  await db.query(
    `UPDATE notification_tasks SET status = 'generated', export_path = $1, updated_at = NOW() WHERE id = $2`,
    [filePath, notificationId]
  );

  return filePath;
}

export async function retryNotification(
  db: Pool,
  notificationId: string
): Promise<boolean> {
  const result = await db.query(
    'SELECT * FROM notification_tasks WHERE id = $1',
    [notificationId]
  );

  if (result.rows.length === 0) return false;

  const notification = result.rows[0];
  if (notification.retry_count >= notification.max_retries) return false;

  await db.query(
    `UPDATE notification_tasks SET retry_count = retry_count + 1, status = 'pending', updated_at = NOW() WHERE id = $1`,
    [notificationId]
  );

  return true;
}

/** Backoff delays in ms for retry attempts (2s, 5s, 10s). */
const RETRY_BACKOFF_MS = [2000, 5000, 10000];

/**
 * Process failed notifications: retry rendering with exponential backoff.
 * Called periodically (e.g. every 30 seconds) by the server tick loop.
 * For each failed notification under max_retries, re-attempts rendering
 * and updates status accordingly.
 */
export async function processRetryQueue(db: Pool): Promise<number> {
  const failed = await db.query(
    `SELECT id, template_key, template_vars, retry_count, max_retries, type
     FROM notification_tasks
     WHERE status = 'failed' AND retry_count < max_retries
     ORDER BY updated_at ASC
     LIMIT 10`
  );

  let processed = 0;

  for (const task of failed.rows) {
    const backoffIdx = Math.min(task.retry_count, RETRY_BACKOFF_MS.length - 1);
    const backoffMs = RETRY_BACKOFF_MS[backoffIdx];

    // Simple delay within the processing loop
    await new Promise(resolve => setTimeout(resolve, backoffMs));

    try {
      // Re-render the notification content
      const tplResult = await db.query(
        'SELECT body FROM notification_templates WHERE template_key = $1 AND is_active = true',
        [task.template_key]
      );

      if (tplResult.rows.length === 0) {
        // Template no longer exists — mark as permanently failed
        await db.query(
          `UPDATE notification_tasks SET status = 'failed', retry_count = max_retries, updated_at = NOW() WHERE id = $1`,
          [task.id]
        );
        continue;
      }

      const rendered = renderTemplate(tplResult.rows[0].body, task.template_vars);

      const newStatus = task.type === 'in_app' ? 'generated' : 'pending';
      await db.query(
        `UPDATE notification_tasks
         SET rendered_content = $1, status = $2, retry_count = retry_count + 1, updated_at = NOW()
         WHERE id = $3`,
        [rendered, newStatus, task.id]
      );

      processed++;
    } catch {
      // Retry failed again — increment count
      await db.query(
        `UPDATE notification_tasks SET retry_count = retry_count + 1, updated_at = NOW() WHERE id = $1`,
        [task.id]
      );
    }
  }

  return processed;
}
