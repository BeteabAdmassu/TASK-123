/**
 * Helpers for parsing API contract constants from shared/api-contracts.ts.
 * Framework-agnostic — usable by both Fastify backend and Angular frontend.
 *
 * Contract format: "METHOD /relative/path"  (e.g., "GET  /health")
 */

/** Strip the HTTP method prefix, returning the relative path. */
export function extractPath(contract: string): string {
  return contract.replace(/^[A-Z]+\s+/, '');
}

/** Return the Fastify-registrable path: "/api" + relative path. */
export function apiPath(contract: string): string {
  return '/api' + extractPath(contract);
}
