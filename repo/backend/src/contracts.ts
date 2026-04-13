/**
 * Compatibility shim — re-exports from the canonical shared contracts.
 * Prefer importing directly from '../../shared/api-contracts' and
 * '../../shared/contract-utils' in new code.
 */
export { SYSTEM, NOTIFICATIONS, APPROVAL_TEMPLATES } from '../../shared/api-contracts';
export { extractPath, apiPath } from '../../shared/contract-utils';
