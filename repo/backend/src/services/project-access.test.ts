/**
 * Static verification tests for project-access and search scoping.
 * Verifies the source code enforces role-based scoping patterns.
 */

import * as fs from 'fs';
import * as path from 'path';

describe('Project Access Service', () => {
  const source = fs.readFileSync(
    path.join(__dirname, 'project-access.ts'), 'utf8'
  );

  it('should check admin/reviewer for broad access', () => {
    expect(source).toContain("userRole === 'admin' || userRole === 'reviewer'");
  });

  it('should check recruiter by project ownership (created_by)', () => {
    expect(source).toContain("created_by = $2");
    expect(source).toContain("userRole === 'recruiter'");
  });

  it('should check approver via approval step assignment', () => {
    expect(source).toContain("ast.approver_id = $2");
    expect(source).toContain("userRole === 'approver'");
  });

  it('should return 403 for unauthorized access', () => {
    expect(source).toContain('status: 403');
  });
});

describe('Search Route Scoping', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'routes', 'search.ts'), 'utf8'
  );

  it('should scope candidates by project ownership for non-privileged', () => {
    expect(source).toContain('rp.created_by = $2');
    expect(source).toContain('c.first_name ILIKE $1');
  });

  it('should scope projects by ownership for non-privileged', () => {
    expect(source).toContain("created_by = $2");
    expect(source).toContain("title ILIKE $1");
  });

  it('should scope postings by project ownership for non-privileged', () => {
    expect(source).toContain("rp.created_by = $2");
    expect(source).toContain("jp.title ILIKE $1");
  });

  it('should scope services to active/paused for non-privileged', () => {
    expect(source).toContain("status IN ('active', 'paused')");
  });

  it('should not restrict search for admin/reviewer', () => {
    expect(source).toContain("isPrivileged");
    expect(source).toContain("userRole === 'admin' || userRole === 'reviewer'");
  });
});

describe('Context Menu Actions', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'frontend', 'src', 'app', 'features',
      'candidate-detail', 'candidate-detail.component.html'), 'utf8'
  );

  it('should include Tag candidate action', () => {
    expect(html).toContain('onTagCandidate()');
    expect(html).toContain('Tag candidate');
  });

  it('should include Request missing materials action', () => {
    expect(html).toContain('onRequestMissingMaterials()');
    expect(html).toContain('Request missing materials');
  });

  it('should include Create approval task action', () => {
    expect(html).toContain('onCreateApprovalTask()');
    expect(html).toContain('Create approval task');
  });
});

describe('Dashboard Role-Safe Loading', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'frontend', 'src', 'app', 'features',
      'dashboard', 'dashboard.component.ts'), 'utf8'
  );

  it('should gate /audit call behind admin role check', () => {
    expect(source).toContain("isAdmin");
    expect(source).toContain("role === 'admin'");
  });

  it('should gate /violations call behind reviewer/admin', () => {
    expect(source).toContain("isReviewer");
  });

  it('should not call authService (wrong name) — must use auth', () => {
    // Verify the fixed reference uses this.auth, not this.authService
    expect(source).toContain("this.auth.getCurrentUserValue()");
    expect(source).not.toContain("this.authService.getCurrentUserValue()");
  });
});

describe('Violations Component Role-Safe Audit', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'frontend', 'src', 'app', 'features',
      'violations', 'violations.component.ts'), 'utf8'
  );

  it('should gate /audit call behind admin role check', () => {
    expect(source).toContain("role !== 'admin'");
  });

  it('should import AuthService', () => {
    expect(source).toContain("import { AuthService }");
  });
});

describe('Candidate Detail Role-Safe Violations', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'frontend', 'src', 'app', 'features',
      'candidate-detail', 'candidate-detail.component.ts'), 'utf8'
  );

  it('should gate /violations call for non-reviewer/admin', () => {
    expect(source).toContain("canViewViolations");
    expect(source).toContain("role === 'reviewer'");
  });
});
