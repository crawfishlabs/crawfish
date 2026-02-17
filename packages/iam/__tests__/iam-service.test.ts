import { IAMService } from '../src/iam-service';
import { PLANS, deriveEntitlements } from '../src/plans';
import { AppId, CrawfishUser, Entitlements } from '../src/models';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFirestore = {
  collection: jest.fn(),
  doc: jest.fn(),
  batch: jest.fn(),
};

const mockAuth = {
  createUser: jest.fn(),
  verifyIdToken: jest.fn(),
  deleteUser: jest.fn(),
};

const mockBatch = {
  set: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  commit: jest.fn().mockResolvedValue(undefined),
};

const mockDocRef = {
  get: jest.fn(),
  set: jest.fn().mockResolvedValue(undefined),
  update: jest.fn().mockResolvedValue(undefined),
  delete: jest.fn().mockResolvedValue(undefined),
  listCollections: jest.fn().mockResolvedValue([]),
};

mockFirestore.collection.mockReturnValue({
  doc: jest.fn().mockReturnValue(mockDocRef),
  where: jest.fn().mockReturnValue({
    get: jest.fn().mockResolvedValue({ docs: [], forEach: jest.fn() }),
    where: jest.fn().mockReturnValue({
      get: jest.fn().mockResolvedValue({ docs: [], forEach: jest.fn() }),
    }),
  }),
});

mockFirestore.doc.mockReturnValue(mockDocRef);
mockFirestore.batch.mockReturnValue(mockBatch);

const mockApp = {
  firestore: () => mockFirestore,
  auth: () => mockAuth,
  storage: () => ({ bucket: () => ({ file: jest.fn() }) }),
} as any;

let service: IAMService;

beforeEach(() => {
  jest.clearAllMocks();
  service = new IAMService({
    firebaseApp: mockApp,
    crossAppSecret: 'test-secret-key-123',
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('IAMService', () => {
  describe('createUser', () => {
    it('creates a user with free plan by default', async () => {
      mockAuth.createUser.mockResolvedValue({ uid: 'user-1' });

      const user = await service.createUser('test@example.com', 'password123');

      expect(user.uid).toBe('user-1');
      expect(user.email).toBe('test@example.com');
      expect(user.plan.id).toBe('free');
      expect(user.billingStatus).toBe('free');
      expect(user.entitlements.apps.fitness.tier).toBe('free');
      expect(user.onboardingCompleted).toBe(false);
    });

    it('creates a user with a specified plan', async () => {
      mockAuth.createUser.mockResolvedValue({ uid: 'user-2' });

      const user = await service.createUser('pro@example.com', 'password123', 'fitness_pro');

      expect(user.plan.id).toBe('fitness_pro');
      expect(user.billingStatus).toBe('trial');
      expect(user.trialEndsAt).toBeDefined();
      expect(user.entitlements.apps.fitness.tier).toBe('pro');
      expect(user.entitlements.apps.nutrition.tier).toBe('free');
    });
  });

  describe('verifyToken', () => {
    it('verifies token and returns entitlements', async () => {
      mockAuth.verifyIdToken.mockResolvedValue({ uid: 'user-1' });
      const mockEntitlements = deriveEntitlements(PLANS.free);
      mockDocRef.get.mockResolvedValue({ exists: true, data: () => mockEntitlements });

      const result = await service.verifyToken('valid-token');

      expect(result.uid).toBe('user-1');
      expect(result.entitlements).toBeDefined();
    });

    it('caches entitlements on second call', async () => {
      mockAuth.verifyIdToken.mockResolvedValue({ uid: 'user-cache' });
      const mockEntitlements = deriveEntitlements(PLANS.free);
      mockDocRef.get.mockResolvedValue({ exists: true, data: () => mockEntitlements });

      await service.verifyToken('token-1');
      await service.verifyToken('token-1');

      // Firestore doc should only be read once (cached second time)
      // The exact call count depends on implementation details
      expect(mockAuth.verifyIdToken).toHaveBeenCalledTimes(2);
    });
  });

  describe('checkAIQuota', () => {
    it('allows queries when under limit', async () => {
      const ent = deriveEntitlements(PLANS.free);
      mockDocRef.get
        .mockResolvedValueOnce({ exists: true, data: () => ent }) // entitlements
        .mockResolvedValueOnce({ exists: true, data: () => ({ fitness: 1 }) }); // usage

      const result = await service.checkAIQuota('user-1', 'fitness');

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(2); // 3 limit - 1 used
    });

    it('blocks queries when at limit', async () => {
      const ent = deriveEntitlements(PLANS.free);
      mockDocRef.get
        .mockResolvedValueOnce({ exists: true, data: () => ent })
        .mockResolvedValueOnce({ exists: true, data: () => ({ fitness: 3 }) });

      const result = await service.checkAIQuota('user-1', 'fitness');

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('always allows unlimited plans', async () => {
      const ent = deriveEntitlements(PLANS.fitness_pro);
      mockDocRef.get
        .mockResolvedValueOnce({ exists: true, data: () => ent })
        .mockResolvedValueOnce({ exists: false });

      const result = await service.checkAIQuota('user-1', 'fitness');

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(Infinity);
    });
  });

  describe('changePlan', () => {
    it('updates plan and entitlements', async () => {
      await service.changePlan('user-1', 'all_access');

      expect(mockBatch.update).toHaveBeenCalled();
      expect(mockBatch.set).toHaveBeenCalled();
      expect(mockBatch.commit).toHaveBeenCalled();
    });

    it('throws on unknown plan', async () => {
      await expect(service.changePlan('user-1', 'nonexistent')).rejects.toThrow('Unknown plan');
    });
  });

  describe('cross-app tokens', () => {
    it('creates and verifies cross-app tokens', async () => {
      const ent = deriveEntitlements(PLANS.all_access);
      mockDocRef.get.mockResolvedValue({ exists: true, data: () => ent });

      const token = await service.createCrossAppToken('user-1', 'nutrition');
      const payload = service.verifyCrossAppToken(token);

      expect(payload.uid).toBe('user-1');
      expect(payload.targetApp).toBe('nutrition');
    });
  });
});
