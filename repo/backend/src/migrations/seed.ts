import { Pool } from 'pg';
import * as bcrypt from 'bcryptjs';
import { config } from '../config';

async function seed(): Promise<void> {
  const pool = new Pool({
    host: config.database.host,
    port: config.database.port,
    user: config.database.user,
    password: config.database.password,
    database: config.database.database,
  });

  try {
    // Check if admin user exists
    const existing = await pool.query("SELECT id FROM users WHERE username = 'admin'");
    if (existing.rows.length > 0) {
      console.log('Seed data already exists, skipping');
      return;
    }

    const adminHash = await bcrypt.hash('admin', 10);
    const recruiterHash = await bcrypt.hash('recruiter', 10);
    const reviewerHash = await bcrypt.hash('reviewer', 10);
    const approverHash = await bcrypt.hash('approver', 10);

    await pool.query('BEGIN');

    // Create default users
    await pool.query(`
      INSERT INTO users (username, password_hash, role, force_password_change) VALUES
      ('admin', $1, 'admin', true),
      ('recruiter', $2, 'recruiter', false),
      ('reviewer', $3, 'reviewer', false),
      ('approver', $4, 'approver', false)
    `, [adminHash, recruiterHash, reviewerHash, approverHash]);

    // Create default violation rules
    await pool.query(`
      INSERT INTO violation_rules (rule_type, rule_config, severity) VALUES
      ('prohibited_phrase', '{"phrases": ["illegal alien", "handicapped", "mankind"]}', 'error'),
      ('missing_field', '{"field": "eeoc_disposition", "message": "EEOC disposition is required"}', 'critical'),
      ('duplicate_pattern', '{"field": "ssn_encrypted", "message": "Duplicate SSN detected"}', 'critical')
    `);

    // Create default notification templates
    await pool.query(`
      INSERT INTO notification_templates (template_key, subject, body, channel) VALUES
      ('approval_requested', 'New Approval Request', 'You have a new approval request from {{requester}} for {{entity_type}} #{{entity_id}}.', 'in_app'),
      ('approval_completed', 'Approval {{decision}}', 'Your approval request for {{entity_type}} #{{entity_id}} has been {{decision}}.', 'in_app'),
      ('violation_flagged', 'Violation Detected', 'A {{severity}} violation has been detected for candidate {{candidate_name}}: {{details}}.', 'in_app'),
      ('materials_requested', 'Missing Materials Request', 'Materials have been requested for candidate {{candidate_name}}: {{message}}.', 'in_app'),
      ('task_overdue', 'Overdue Task', 'You have an overdue task: {{task_description}}.', 'in_app')
    `);

    // Seed notification tasks for admin (required by integration tests)
    const adminRow = await pool.query("SELECT id FROM users WHERE username = 'admin'");
    const adminId = adminRow.rows[0].id;
    await pool.query(`
      INSERT INTO notification_tasks (recipient_id, type, template_key, template_vars, rendered_content, status) VALUES
      ($1, 'in_app', 'approval_requested',
       '{"requester": "System", "entity_type": "project", "entity_id": "seed-0001"}',
       'You have a new approval request from System for project #seed-0001.', 'pending'),
      ($1, 'in_app', 'task_overdue',
       '{"task_description": "Review pending candidates"}',
       'You have an overdue task: Review pending candidates.', 'pending')
    `, [adminId]);

    await pool.query('COMMIT');
    console.log('Seed data applied successfully');
  } catch (err) {
    console.error('Seed failed:', err);
    throw err;
  } finally {
    await pool.end();
  }
}

seed().catch((err) => {
  console.error('Seed runner failed:', err);
  process.exit(1);
});
