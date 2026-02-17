import { InMemoryRateLimitStore, createRateLimiter, RATE_LIMIT_PRESETS } from '../src/rate-limiter';

describe('InMemoryRateLimitStore', () => {
  let store: InMemoryRateLimitStore;

  beforeEach(() => {
    store = new InMemoryRateLimitStore();
  });

  afterEach(() => {
    store.destroy();
  });

  it('counts hits in a sliding window', async () => {
    const r1 = await store.hit('user1', 60_000);
    expect(r1.count).toBe(1);
    const r2 = await store.hit('user1', 60_000);
    expect(r2.count).toBe(2);
    const r3 = await store.hit('user1', 60_000);
    expect(r3.count).toBe(3);
  });

  it('isolates keys', async () => {
    await store.hit('user1', 60_000);
    await store.hit('user1', 60_000);
    const r = await store.hit('user2', 60_000);
    expect(r.count).toBe(1);
  });

  it('resets a key', async () => {
    await store.hit('user1', 60_000);
    await store.hit('user1', 60_000);
    await store.reset('user1');
    const r = await store.hit('user1', 60_000);
    expect(r.count).toBe(1);
  });

  it('expires old entries from the window', async () => {
    // Use a very short window
    await store.hit('user1', 50);
    await new Promise(r => setTimeout(r, 100));
    const result = await store.hit('user1', 50);
    // The first hit should have expired
    expect(result.count).toBe(1);
  });
});

describe('createRateLimiter middleware', () => {
  function mockReq(overrides: any = {}) {
    return {
      ip: '127.0.0.1',
      method: 'GET',
      baseUrl: '/api',
      path: '/coach',
      socket: { remoteAddress: '127.0.0.1' },
      ...overrides,
    } as any;
  }

  function mockRes() {
    const headers: Record<string, string> = {};
    const res: any = {
      setHeader: jest.fn((k: string, v: string) => { headers[k] = v; }),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      _headers: headers,
    };
    return res;
  }

  it('allows requests under the limit', async () => {
    const limiter = createRateLimiter({ maxRequests: 5, windowMs: 60_000 });
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();

    await limiter(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('blocks requests over the limit with 429', async () => {
    const limiter = createRateLimiter({ maxRequests: 2, windowMs: 60_000 });
    const req = mockReq({ user: { uid: 'test-user' } });
    const next = jest.fn();

    // First 2 should pass
    await limiter(req, mockRes(), next);
    await limiter(req, mockRes(), next);
    expect(next).toHaveBeenCalledTimes(2);

    // Third should be blocked
    const res3 = mockRes();
    await limiter(req, res3, next);
    expect(res3.status).toHaveBeenCalledWith(429);
    expect(res3.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Too Many Requests' }));
  });

  it('sets rate limit headers', async () => {
    const limiter = createRateLimiter({ maxRequests: 10, windowMs: 60_000 });
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();

    await limiter(req, res, next);
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', '10');
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', expect.any(String));
  });

  it('respects burst allowance', async () => {
    const limiter = createRateLimiter({ maxRequests: 2, windowMs: 60_000, burstAllowance: 1 });
    const req = mockReq({ user: { uid: 'burst-user' } });
    const next = jest.fn();

    await limiter(req, mockRes(), next);
    await limiter(req, mockRes(), next);
    await limiter(req, mockRes(), next); // This should pass (burst)
    expect(next).toHaveBeenCalledTimes(3);

    // 4th should be blocked
    const res4 = mockRes();
    await limiter(req, res4, next);
    expect(res4.status).toHaveBeenCalledWith(429);
  });

  it('includes Retry-After header on 429', async () => {
    const limiter = createRateLimiter({ maxRequests: 1, windowMs: 60_000 });
    const req = mockReq({ user: { uid: 'retry-user' } });
    const next = jest.fn();

    await limiter(req, mockRes(), next);
    const res2 = mockRes();
    await limiter(req, res2, next);
    expect(res2.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(String));
  });

  it('presets are properly configured', () => {
    expect(RATE_LIMIT_PRESETS.AI_COACH.maxRequests).toBe(10);
    expect(RATE_LIMIT_PRESETS.AI_COACH.windowMs).toBe(60_000);
    expect(RATE_LIMIT_PRESETS.QUERY.maxRequests).toBe(30);
    expect(RATE_LIMIT_PRESETS.STANDARD.maxRequests).toBe(60);
  });
});
