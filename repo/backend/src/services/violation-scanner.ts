import { Pool } from 'pg';
import { ViolationRule } from '../models';

interface ScanResult {
  ruleId: string;
  details: Record<string, unknown>;
}

export async function scanCandidate(
  db: Pool,
  candidateId: string
): Promise<ScanResult[]> {
  // Get active violation rules
  const rulesResult = await db.query(
    'SELECT * FROM violation_rules WHERE is_active = true'
  );
  const rules: ViolationRule[] = rulesResult.rows;

  // Get candidate data
  const candidateResult = await db.query(
    'SELECT * FROM candidates WHERE id = $1',
    [candidateId]
  );
  if (candidateResult.rows.length === 0) return [];
  const candidate = candidateResult.rows[0];

  // Get latest resume content
  const resumeResult = await db.query(
    `SELECT content FROM resume_versions
     WHERE candidate_id = $1
     ORDER BY version_number DESC LIMIT 1`,
    [candidateId]
  );
  const resumeContent = resumeResult.rows[0]?.content;

  const violations: ScanResult[] = [];

  for (const rule of rules) {
    const ruleConfig = rule.rule_config as Record<string, unknown>;

    switch (rule.rule_type) {
      case 'prohibited_phrase': {
        const phrases = (ruleConfig.phrases as string[]) || [];
        const contentStr = JSON.stringify(resumeContent || '').toLowerCase();
        const candidateStr = `${candidate.first_name} ${candidate.last_name} ${candidate.email || ''} ${candidate.eeoc_disposition || ''}`.toLowerCase();
        const searchText = contentStr + ' ' + candidateStr;

        for (const phrase of phrases) {
          if (searchText.includes(phrase.toLowerCase())) {
            violations.push({
              ruleId: rule.id,
              details: {
                type: 'prohibited_phrase',
                phrase,
                severity: rule.severity,
                message: `Prohibited phrase detected: "${phrase}"`,
              },
            });
          }
        }
        break;
      }

      case 'missing_field': {
        const field = ruleConfig.field as string;
        const message = ruleConfig.message as string;
        if (field && !candidate[field]) {
          violations.push({
            ruleId: rule.id,
            details: {
              type: 'missing_field',
              field,
              severity: rule.severity,
              message: message || `Required field missing: ${field}`,
            },
          });
        }
        break;
      }

      case 'duplicate_pattern': {
        const field = ruleConfig.field as string;
        // For encrypted fields like ssn_encrypted, use the deterministic hash
        // column (ssn_hash) for comparison instead of comparing random ciphertext.
        const HASH_FIELD_MAP: Record<string, string> = {
          ssn_encrypted: 'ssn_hash',
        };
        const lookupField = HASH_FIELD_MAP[field] || field;
        const lookupValue = candidate[lookupField] || candidate[field];

        // Validate field name is a safe SQL identifier
        if (field && lookupValue && /^[a-z_][a-z0-9_]*$/.test(lookupField)) {
          const dupeResult = await db.query(
            `SELECT id FROM candidates
             WHERE "${lookupField}" = $1 AND id != $2 AND archived_at IS NULL`,
            [lookupValue, candidateId]
          );
          if (dupeResult.rows.length > 0) {
            violations.push({
              ruleId: rule.id,
              details: {
                type: 'duplicate_pattern',
                field,
                severity: rule.severity,
                message: (ruleConfig.message as string) || `Duplicate value detected for ${field}`,
                duplicateIds: dupeResult.rows.map((r: { id: string }) => r.id),
              },
            });
          }
        }
        break;
      }

      case 'custom': {
        // Custom rules check resume content structure
        if (resumeContent && ruleConfig.requiredSections) {
          const sections = ruleConfig.requiredSections as string[];
          const contentKeys = Object.keys(resumeContent);
          for (const section of sections) {
            if (!contentKeys.includes(section)) {
              violations.push({
                ruleId: rule.id,
                details: {
                  type: 'custom',
                  severity: rule.severity,
                  message: `Required resume section missing: ${section}`,
                  section,
                },
              });
            }
          }
        }
        break;
      }
    }
  }

  // Insert violations (idempotent - skip duplicates)
  for (const v of violations) {
    const existing = await db.query(
      `SELECT id FROM violation_instances
       WHERE candidate_id = $1 AND rule_id = $2 AND status = 'pending'
       AND details->>'message' = $3`,
      [candidateId, v.ruleId, (v.details as Record<string, string>).message]
    );
    if (existing.rows.length === 0) {
      await db.query(
        `INSERT INTO violation_instances (candidate_id, rule_id, details, status)
         VALUES ($1, $2, $3, 'pending')`,
        [candidateId, v.ruleId, JSON.stringify(v.details)]
      );
    }
  }

  return violations;
}
