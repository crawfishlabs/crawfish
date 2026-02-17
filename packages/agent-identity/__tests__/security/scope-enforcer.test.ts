import { enforce, isScopeCovered } from '../../src/security/scope-enforcer';

describe('Scope Enforcer', () => {
  describe('isScopeCovered()', () => {
    it('matches exact scopes', () => {
      expect(isScopeCovered('repo:read', ['repo:read'])).toBe(true);
    });

    it('rejects non-matching scopes', () => {
      expect(isScopeCovered('repo:write', ['repo:read'])).toBe(false);
    });

    it('supports hierarchical scopes', () => {
      expect(isScopeCovered('repo:read', ['repo'])).toBe(true);
      expect(isScopeCovered('repo:write', ['repo'])).toBe(true);
      expect(isScopeCovered('repo:admin:settings', ['repo'])).toBe(true);
      expect(isScopeCovered('repo:admin:settings', ['repo:admin'])).toBe(true);
    });

    it('does not match partial prefixes', () => {
      // 'repo' should not match 'repository:read'
      expect(isScopeCovered('repository:read', ['repo'])).toBe(false);
    });

    it('supports wildcard', () => {
      expect(isScopeCovered('repo:read', ['*'])).toBe(true);
      expect(isScopeCovered('anything:at:all', ['*'])).toBe(true);
    });

    it('checks multiple granted scopes', () => {
      expect(isScopeCovered('calendar:write', ['repo:read', 'calendar:write'])).toBe(true);
    });
  });

  describe('enforce()', () => {
    it('allows when all scopes are covered', () => {
      const result = enforce(['repo:read', 'repo:write'], ['repo']);
      expect(result.allowed).toBe(true);
      expect(result.denied).toEqual([]);
    });

    it('denies when scopes are not covered', () => {
      const result = enforce(['repo:read', 'plaid:transactions:read'], ['repo']);
      expect(result.allowed).toBe(false);
      expect(result.denied).toEqual(['plaid:transactions:read']);
    });

    it('reports all denied scopes', () => {
      const result = enforce(['repo:read', 'plaid:read', 'health:read'], ['calendar']);
      expect(result.allowed).toBe(false);
      expect(result.denied).toHaveLength(3);
    });

    it('allows everything with wildcard', () => {
      const result = enforce(['repo:read', 'plaid:write', 'health:read'], ['*']);
      expect(result.allowed).toBe(true);
      expect(result.denied).toEqual([]);
    });

    it('allows empty requested scopes', () => {
      const result = enforce([], ['repo']);
      expect(result.allowed).toBe(true);
    });

    it('denies with empty granted scopes', () => {
      const result = enforce(['repo:read'], []);
      expect(result.allowed).toBe(false);
    });

    it('calls escalation logger on denial', () => {
      const events: any[] = [];
      enforce(['repo:write'], ['repo:read'], (event) => events.push(event));
      expect(events).toHaveLength(1);
      expect(events[0].denied).toEqual(['repo:write']);
      expect(events[0].timestamp).toBeDefined();
    });

    it('does not call escalation logger on success', () => {
      const events: any[] = [];
      enforce(['repo:read'], ['repo'], (event) => events.push(event));
      expect(events).toHaveLength(0);
    });
  });
});
