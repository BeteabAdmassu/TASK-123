/**
 * Project Access Service – Behavior Tests
 *
 * Tests the actual checkProjectAccess and checkPostingAccess functions
 * with mock DB queries rather than inspecting source code strings.
 */

import { checkProjectAccess, checkPostingAccess } from './project-access';

const mockQuery = jest.fn();
const mockDb = { query: mockQuery } as any;

beforeEach(() => {
  mockQuery.mockReset();
});

describe('checkProjectAccess', () => {
  const PROJECT_ID = 'proj-1';

  it('should allow admin access without DB query', async () => {
    const result = await checkProjectAccess(mockDb, PROJECT_ID, 'admin-id', 'admin');
    expect(result.allowed).toBe(true);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('should allow reviewer access without DB query', async () => {
    const result = await checkProjectAccess(mockDb, PROJECT_ID, 'reviewer-id', 'reviewer');
    expect(result.allowed).toBe(true);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('should allow recruiter who owns the project', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ '1': 1 }] }); // ownership check

    const result = await checkProjectAccess(mockDb, PROJECT_ID, 'recruiter-id', 'recruiter');
    expect(result.allowed).toBe(true);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('should deny recruiter who does not own the project', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // ownership check fails

    const result = await checkProjectAccess(mockDb, PROJECT_ID, 'other-recruiter', 'recruiter');
    expect(result.allowed).toBe(false);
    expect(result.status).toBe(403);
  });

  it('should allow approver with an approval step assignment in the project', async () => {
    // For approver role, code skips recruiter check and goes to approver check
    mockQuery.mockResolvedValueOnce({ rows: [{ '1': 1 }] }); // approver check

    const result = await checkProjectAccess(mockDb, PROJECT_ID, 'approver-id', 'approver');
    expect(result.allowed).toBe(true);
  });

  it('should deny approver with no approval step assignment', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // approver check fails

    const result = await checkProjectAccess(mockDb, PROJECT_ID, 'unrelated-approver', 'approver');
    expect(result.allowed).toBe(false);
    expect(result.status).toBe(403);
  });
});

describe('checkPostingAccess', () => {
  const POSTING_ID = 'posting-1';
  const PROJECT_ID = 'proj-1';

  it('should allow admin access without DB query', async () => {
    const result = await checkPostingAccess(mockDb, POSTING_ID, 'admin-id', 'admin');
    expect(result.allowed).toBe(true);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('should look up parent project for non-privileged roles', async () => {
    // Posting lookup returns project_id
    mockQuery.mockResolvedValueOnce({ rows: [{ project_id: PROJECT_ID }] });
    // Project ownership check passes
    mockQuery.mockResolvedValueOnce({ rows: [{ '1': 1 }] });

    const result = await checkPostingAccess(mockDb, POSTING_ID, 'recruiter-id', 'recruiter');
    expect(result.allowed).toBe(true);
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it('should return 404 if posting not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // posting not found

    const result = await checkPostingAccess(mockDb, POSTING_ID, 'recruiter-id', 'recruiter');
    expect(result.allowed).toBe(false);
    expect(result.status).toBe(404);
  });

  it('should deny recruiter who does not own the parent project', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ project_id: PROJECT_ID }] }); // posting found
    mockQuery.mockResolvedValueOnce({ rows: [] }); // ownership check fails

    const result = await checkPostingAccess(mockDb, POSTING_ID, 'other-recruiter', 'recruiter');
    expect(result.allowed).toBe(false);
    expect(result.status).toBe(403);
  });
});
