import { createIAMMiddleware } from '../src/middleware';
import { deriveEntitlements } from '../src/plans';
import { PLANS } from '../src/plans';

// ---------------------------------------------------------------------------
// Mock IAMService
// ---------------------------------------------------------------------------

const mockIAMService = {
  verifyToken: jest.fn(),
  checkAIQuota: jest.fn(),
  consumeAIQuota: jest.fn(),
  checkPermission: jest.fn(),
} as any;

const { iamAuth, aiQuota, requirePermission } = createIAMMiddleware(mockIAMService);

function mockReqResNext() {
  const req: any = {
    headers: { authorization: 'Bearer valid-token' },
    params: { id: 'resource-1' },
    body: {},
  };
  const res: any = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    set: jest.fn(),
  };
  const next = jest.fn();
  return { req, res, next };
}

beforeEach(() => jest.clearAllMocks());

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('iamAuth middleware', () => {
  it('returns 401 when no token', async () => {
    const { req, res, next } = mockReqResNext();
    req.headers = {};

    await iamAuth()(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('sets userId and entitlements on success', async () => {
    const { req, res, next } = mockReqResNext();
    const ent = deriveEntitlements(PLANS.all_access);
    mockIAMService.verifyToken.mockResolvedValue({ uid: 'user-1', entitlements: ent });

    await iamAuth()(req, res, next);

    expect(req.userId).toBe('user-1');
    expect(req.entitlements).toBe(ent);
    expect(next).toHaveBeenCalled();
  });

  it('returns 403 when app access required but not available', async () => {
    const { req, res, next } = mockReqResNext();
    const ent = deriveEntitlements(PLANS.free);
    // Free plan has access but tier is 'free', let's test with a modified entitlement
    ent.apps.fitness.hasAccess = false;
    mockIAMService.verifyToken.mockResolvedValue({ uid: 'user-1', entitlements: ent });

    await iamAuth({ requireApp: 'fitness' })(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'upgrade_required' }),
    );
  });

  it('returns 403 when required feature is missing', async () => {
    const { req, res, next } = mockReqResNext();
    const ent = deriveEntitlements(PLANS.free);
    mockIAMService.verifyToken.mockResolvedValue({ uid: 'user-1', entitlements: ent });

    await iamAuth({ requireFeature: 'export_data' })(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'feature_not_available' });
  });
});

describe('aiQuota middleware', () => {
  it('passes when quota available', async () => {
    const { req, res, next } = mockReqResNext();
    req.userId = 'user-1';
    mockIAMService.checkAIQuota.mockResolvedValue({
      allowed: true,
      remaining: 5,
      resetsAt: new Date(),
    });

    await aiQuota('fitness')(req, res, next);

    expect(res.set).toHaveBeenCalledWith('X-AI-Remaining', '5');
    expect(mockIAMService.consumeAIQuota).toHaveBeenCalledWith('user-1', 'fitness');
    expect(next).toHaveBeenCalled();
  });

  it('returns 429 when quota exceeded', async () => {
    const { req, res, next } = mockReqResNext();
    req.userId = 'user-1';
    mockIAMService.checkAIQuota.mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetsAt: new Date('2026-01-02'),
    });

    await aiQuota('fitness')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('requirePermission middleware', () => {
  it('passes when permission granted', async () => {
    const { req, res, next } = mockReqResNext();
    req.userId = 'user-1';
    mockIAMService.checkPermission.mockResolvedValue(true);

    await requirePermission('budget', 'write')(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('returns 403 when permission denied', async () => {
    const { req, res, next } = mockReqResNext();
    req.userId = 'user-1';
    mockIAMService.checkPermission.mockResolvedValue(false);

    await requirePermission('budget', 'write')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
  });
});
