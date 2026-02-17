import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GrantQueue } from '../src/grants.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('GrantQueue', () => {
  let tempDir: string;
  let queue: GrantQueue;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'grants-test-'));
    queue = new GrantQueue({ path: join(tempDir, 'grants.json') });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should create a grant with pending status', async () => {
    const grant = await queue.create({
      service: 'github',
      scopes: ['repo'],
      agent: 'craw',
      principal: 'sam',
    });
    expect(grant.id).toMatch(/^g_/);
    expect(grant.status).toBe('pending');
    expect(grant.service).toBe('github');
  });

  it('should list pending grants', async () => {
    await queue.create({ service: 'github', agent: 'craw', principal: 'sam' });
    await queue.create({ service: 'vercel', agent: 'craw', principal: 'sam' });
    const pending = await queue.pending();
    expect(pending).toHaveLength(2);
  });

  it('should approve a grant', async () => {
    const grant = await queue.create({ service: 'github', agent: 'craw', principal: 'sam' });
    const approved = await queue.approve(grant.id, 'sam');
    expect(approved?.status).toBe('approved');
    expect(approved?.oauth_state).toBeTruthy();
    expect(approved?.resolved_by).toBe('sam');
  });

  it('should deny a grant', async () => {
    const grant = await queue.create({ service: 'github', agent: 'craw', principal: 'sam' });
    const denied = await queue.deny(grant.id, 'not needed');
    expect(denied?.status).toBe('denied');
    expect(denied?.deny_reason).toBe('not needed');
  });

  it('should activate an approved grant', async () => {
    const grant = await queue.create({ service: 'github', agent: 'craw', principal: 'sam' });
    await queue.approve(grant.id);
    const active = await queue.activate(grant.id);
    expect(active?.status).toBe('active');
  });

  it('should find grant by OAuth state', async () => {
    const grant = await queue.create({ service: 'github', agent: 'craw', principal: 'sam' });
    const approved = await queue.approve(grant.id);
    const found = await queue.findByOAuthState(approved!.oauth_state!);
    expect(found?.id).toBe(grant.id);
  });

  it('should revoke an active grant', async () => {
    const grant = await queue.create({ service: 'github', agent: 'craw', principal: 'sam' });
    await queue.approve(grant.id);
    await queue.activate(grant.id);
    const revoked = await queue.revoke('github');
    expect(revoked?.status).toBe('revoked');
  });

  it('should not approve an already denied grant', async () => {
    const grant = await queue.create({ service: 'github', agent: 'craw', principal: 'sam' });
    await queue.deny(grant.id);
    const result = await queue.approve(grant.id);
    expect(result).toBeUndefined();
  });

  it('should persist across instances', async () => {
    const path = join(tempDir, 'grants.json');
    const q1 = new GrantQueue({ path });
    await q1.create({ service: 'github', agent: 'craw', principal: 'sam' });

    const q2 = new GrantQueue({ path });
    const pending = await q2.pending();
    expect(pending).toHaveLength(1);
    expect(pending[0].service).toBe('github');
  });
});
