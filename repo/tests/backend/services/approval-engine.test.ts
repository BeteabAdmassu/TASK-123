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
  });
});
