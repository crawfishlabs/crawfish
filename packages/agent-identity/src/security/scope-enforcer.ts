/**
 * Scope Enforcer — Validates that requested scopes are within granted scopes.
 *
 * Supports:
 * - Exact matching: 'repo:read' matches 'repo:read'
 * - Hierarchical scopes: 'repo' grants 'repo:read', 'repo:write', 'repo:admin'
 * - Wildcards: '*' grants all scopes for a service
 * - Escalation logging
 */

export interface ScopeEnforcementResult {
  allowed: boolean;
  denied: string[];
}

export interface ScopeEscalationEvent {
  requested: string[];
  granted: string[];
  denied: string[];
  timestamp: string;
}

export type EscalationLogger = (event: ScopeEscalationEvent) => void;

/**
 * Check if a single requested scope is covered by any granted scope.
 *
 * Rules:
 * - '*' in granted covers everything
 * - Exact match: 'repo:read' covers 'repo:read'
 * - Hierarchical: 'repo' covers 'repo:read', 'repo:write', 'repo:admin:settings'
 *   (a granted scope is a parent if the requested scope starts with granted + ':')
 */
export function isScopeCovered(requested: string, granted: string[]): boolean {
  for (const g of granted) {
    // Wildcard covers everything
    if (g === '*') return true;

    // Exact match
    if (g === requested) return true;

    // Hierarchical: granted 'repo' covers requested 'repo:read'
    if (requested.startsWith(g + ':')) return true;
  }
  return false;
}

/**
 * Enforce scope constraints.
 *
 * @param requested - Scopes the agent is requesting
 * @param granted - Scopes the principal has granted to the agent
 * @param onEscalation - Optional callback for logging escalation attempts
 * @returns { allowed: true, denied: [] } if all scopes covered,
 *          { allowed: false, denied: ['scope1', ...] } if any denied
 */
export function enforce(
  requested: string[],
  granted: string[],
  onEscalation?: EscalationLogger,
): ScopeEnforcementResult {
  const denied: string[] = [];

  for (const scope of requested) {
    if (!isScopeCovered(scope, granted)) {
      denied.push(scope);
    }
  }

  const allowed = denied.length === 0;

  if (!allowed && onEscalation) {
    onEscalation({
      requested,
      granted,
      denied,
      timestamp: new Date().toISOString(),
    });
  }

  return { allowed, denied };
}
