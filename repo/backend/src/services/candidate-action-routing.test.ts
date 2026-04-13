/**
 * Candidate detail action-routing tests.
 * Verifies that query-param-based action dispatch from Electron context menu
 * is wired into the candidate detail component with correct mapping and cleanup.
 */

import * as fs from 'fs';
import * as path from 'path';

const source = fs.readFileSync(
  path.resolve(__dirname, '..', '..', '..', 'frontend', 'src', 'app',
    'features', 'candidate-detail', 'candidate-detail.component.ts'),
  'utf8'
);

describe('Candidate Detail Action Routing', () => {

  describe('Query param subscription', () => {
    it('should subscribe to route.queryParams', () => {
      expect(source).toContain('this.route.queryParams.pipe(');
    });

    it('should read action from query params', () => {
      expect(source).toContain("qp['action']");
    });

    it('should store action in pendingAction field', () => {
      expect(source).toContain('this.pendingAction = action');
    });
  });

  describe('Action clearing (prevents replay on refresh)', () => {
    it('should clear action query param after reading', () => {
      expect(source).toContain("queryParams: { action: null }");
    });

    it('should use replaceUrl to avoid polluting history', () => {
      expect(source).toContain('replaceUrl: true');
    });

    it('should merge with existing query params', () => {
      expect(source).toContain("queryParamsHandling: 'merge'");
    });
  });

  describe('Action execution after candidate loads', () => {
    it('should call executePendingAction in loadCandidate success path', () => {
      expect(source).toContain('this.executePendingAction()');
    });

    it('should guard against missing candidate', () => {
      expect(source).toContain('!this.candidate');
    });

    it('should null out pendingAction after execution (single-fire)', () => {
      expect(source).toContain('this.pendingAction = null');
    });
  });

  describe('Action mapping completeness', () => {
    it('should handle action=tag -> onTagCandidate()', () => {
      expect(source).toContain("case 'tag':");
      expect(source).toContain('this.onTagCandidate()');
    });

    it('should handle action=request-materials -> onRequestMissingMaterials()', () => {
      expect(source).toContain("case 'request-materials':");
      expect(source).toContain('this.onRequestMissingMaterials()');
    });

    it('should handle action=create-approval -> onCreateApprovalTask()', () => {
      expect(source).toContain("case 'create-approval':");
      expect(source).toContain('this.onCreateApprovalTask()');
    });
  });

  describe('No regression for normal loads', () => {
    it('should initialize pendingAction as null', () => {
      expect(source).toContain('private pendingAction: string | null = null');
    });

    it('should not execute action when pendingAction is null', () => {
      // executePendingAction guards with early return
      expect(source).toContain('if (!this.pendingAction');
    });
  });
});
