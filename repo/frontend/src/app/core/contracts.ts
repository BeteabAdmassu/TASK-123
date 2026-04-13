/**
 * Compatibility shim — re-exports from the canonical shared contracts.
 * Prefer importing directly from '@contracts' and '@contract-utils' in new code.
 */
export { NOTIFICATIONS, APPROVAL_TEMPLATES, APPROVALS } from '@contracts';
export { extractPath } from '@contract-utils';
