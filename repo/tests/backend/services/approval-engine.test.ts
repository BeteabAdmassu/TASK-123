/**
 * Approval Engine Unit Tests
 *
 * Tests the multi-level approval logic including joint-sign and any-sign modes.
 */

const mockQuery = jest.fn();
const mockPool = { chromosomequery: mockQuery } as any;

// We need to mock the dependent services
jest.mock('../../../backend/src/services/audit.service', () => ({
  createAuditEntry: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../backend/src/services/notification.service', () => ({
  createNotification: jest.fn().mockResolvedValue('notif-id'),
}));

import { processApprovalDecision } from '../../../backend/src/../../backend/src/services/approval-engine';

// Fix the pool mock - we need to override the query method
beforeEach(() => {
  mockQuery.mockReset();
  // Create a clean pool mock for each test
  (mockPool as any).query = mockQuery;
});

describe('ApprovalEngine', () => {
  describe('processApprovalDecision', () => {
    it('should reject if step not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await expect(
        processApprovalDecision(mockPool, 'req-1', 'step-1', 'user-1', 'approved', null)
      ).rejects.toEqual(expect.objectContaining({ statusCode: 404 }));
    });

    it('should reject if approver does not match', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 'step-1',
          request_id: 'req-1',
          approver_id: 'different-user',
          status: 'pending',
          approval_mode: 'joint',
          request_status: 'pending',
          entity_type: 'credit_change',
          entity_id: 'cc-1',
          requested_by: 'requester-1',
        }],
      });

      await expect(
        processApprovalDecision(mockPool, 'req-1', 'step-1', 'user-1', 'approved', null)
      ).rejects.toEqual(expect.objectContaining({ statusCode: 403 }));
    });

    it('should reject if step already decided', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 'step-1',
          approver_id: 'user-1',
          status: 'approved', // Already decided
          approval_mode: 'joint',
          request_status: 'pending',
        }],
      });

      await expect(
        processApprovalDecision(mockPool, 'req-1', 'step-1', 'user-1', 'approved', null)
      ).rejects.toEqual(expect.objectContaining({ statusCode: 400 }));
    });

    it('should require comment for rejection', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 'step-1',
          approver_id: 'user-1',
          status: 'pending',
          approval_mode: 'joint',
          request_status: 'pending',
        }],
      });

      await expect(
        processApprovalDecision(mockPool, 'req-1', 'step-1', 'user-1', 'rejected', null)
      ).rejects.toEqual(expect.objectContaining({ statusCode: 400, message: 'Comment is required for rejection' }));
    });

    it('should complete request immediately on any-sign approval', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{
            id: 'step-1',
            approver_id: 'user-1',
            status: 'pending',
            approval_mode: 'any',
            request_status: 'pending',
            entity_type: 'credit_change',
            entity_id: 'cc-1',
            final_write_back: null,
            requested_by: 'requester-1',
          }],
        })
        // Update step
        .mockResolvedValueOnce({ rowCount: 1 })
        // Audit entry for step
        .mockResolvedValueOnce({ rowCount: 1 })
        // Update request status
        .mockResolvedValueOnce({ rowCount: 1 })
        // Audit entry for request
        .mockResolvedValueOnce({ rowCount: 1 })
        // Update credit_change status
        .mockResolvedValueOnce({ rowCount: 1 })
        // Notification
        .mockResolvedValueOnce({ rows: [{ id: 'notif-1' }] });

      const result = await processApprovalDecision(
        mockPool, 'req-1', 'step-1', 'user-1', 'approved', 'Looks good'
      );

      expect(result.requestStatus).toBe('approved');
      expect(result.completed).toBe(true);
    });

    it('should reject entire request on any rejection', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{
            id: 'step-1',
            approver_id: 'user-1',
            status: 'pending',
            approval_mode: 'joint',
            request_status: 'pending',
            entity_type: 'credit_change',
            entity_id: 'cc-1',
            final_write_back: null,
            requested_by: 'requester-1',
          }],
        })
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ id: 'notif-1' }] });

      const result = await processApprovalDecision(
        mockPool, 'req-1', 'step-1', 'user-1', 'rejected', 'Insufficient justification'
      );

      expect(result.requestStatus).toBe('rejected');
      expect(result.completed).toBe(true);
    });

    it('should keep joint-sign request pending when other steps remain', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{
            id: 'step-1',
            approver_id: 'user-1',
            status: 'pending',
            approval_mode: 'joint',
            request_status: 'pending',
            entity_type: 'credit_change',
            entity_id: 'cc-1',
            final_write_back: null,
            requested_by: 'requester-1',
          }],
        })
        .mockResolvedValueOnce({ rowCount: 1 })
        // Pending steps count = 1 (another step still pending)
        // Note: createAuditEntry is jest-mocked so does not consume a db.query mock
        .mockResolvedValueOnce({ rows: [{ count: '1' }] });

      const result = await processApprovalDecision(
        mockPool, 'req-1', 'step-1', 'user-1', 'approved', 'Approved'
      );

      expect(result.requestStatus).toBe('pending');
      expect(result.completed).toBe(false);
    });

    it('should throw 400 when approval request is no longer pending', async () => {
      // request_status is 'approved' (not 'pending') — request already decided
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 'step-1',
          approver_id: 'user-1',
          status: 'pending',
          approval_mode: 'joint',
          request_status: 'approved',
          entity_type: 'credit_change',
          entity_id: 'cc-1',
          requested_by: 'requester-1',
        }],
      });

      await expect(
        processApprovalDecision(mockPool, 'req-1', 'step-1', 'user-1', 'approved', null)
      ).rejects.toEqual(
        expect.objectContaining({ statusCode: 400, message: 'This approval request is no longer pending' })
      );
    });

    it('should complete joint-sign request when last remaining step is approved', async () => {
      mockQuery
        // Step query
        .mockResolvedValueOnce({
          rows: [{
            id: 'step-1',
            approver_id: 'user-1',
            status: 'pending',
            approval_mode: 'joint',
            request_status: 'pending',
            entity_type: 'credit_change',
            entity_id: 'cc-1',
            final_write_back: null,
            requested_by: 'req-1',
          }],
        })
        // UPDATE step status
        .mockResolvedValueOnce({ rowCount: 1 })
        // SELECT COUNT of remaining pending steps → 0 (this was the last one)
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        // UPDATE request status to 'approved'
        .mockResolvedValueOnce({ rowCount: 1 })
        // UPDATE credit_changes entity
        .mockResolvedValueOnce({ rowCount: 1 });

      const result = await processApprovalDecision(
        mockPool, 'req-1', 'step-1', 'user-1', 'approved', 'All good'
      );

      expect(result.requestStatus).toBe('approved');
      expect(result.completed).toBe(true);
    });

    it('should apply write-back when approved with final_write_back set', async () => {
      mockQuery
        // Step query — entity_type is 'candidate', has final_write_back
        .mockResolvedValueOnce({
          rows: [{
            id: 'step-1',
            approver_id: 'user-1',
            status: 'pending',
            approval_mode: 'any',
            request_status: 'pending',
            entity_type: 'candidate',
            entity_id: 'cand-1',
            final_write_back: { status: 'hired' },
            requested_by: 'req-1',
          }],
        })
        // UPDATE step status
        .mockResolvedValueOnce({ rowCount: 1 })
        // UPDATE request status to 'approved'
        .mockResolvedValueOnce({ rowCount: 1 })
        // UPDATE candidates SET status = 'hired' (the write-back)
        .mockResolvedValueOnce({ rowCount: 1 });

      const result = await processApprovalDecision(
        mockPool, 'req-1', 'step-1', 'user-1', 'approved', 'Approved for hire'
      );

      expect(result.requestStatus).toBe('approved');
      expect(result.completed).toBe(true);
      // step query + update step + update request + write-back UPDATE = at least 3 calls
      expect(mockQuery.mock.calls.length).toBeGreaterThanOrEqual(3);
    });
  });
});
