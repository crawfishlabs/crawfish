import { assignVariant } from '../src/ab-testing';
import { DEFAULT_FLAGS, DEFAULT_FLAG_MAP } from '../src/default-flags';

// Mock firebase-admin
jest.mock('firebase-admin', () => {
  const mockFirestore = {
    collection: jest.fn().mockReturnThis(),
    doc: jest.fn().mockReturnThis(),
    get: jest.fn().mockResolvedValue({ exists: false }),
    add: jest.fn().mockResolvedValue({ id: 'test-event-id' }),
  };

  const mockTemplate = {
    parameters: {
      fitness_ai_coach_enabled: { defaultValue: { value: 'true' } },
      global_dark_mode: { defaultValue: { value: 'true' } },
    },
  };

  return {
    firestore: jest.fn(() => mockFirestore),
    remoteConfig: jest.fn(() => ({
      getTemplate: jest.fn().mockResolvedValue(mockTemplate),
    })),
  };
});

describe('Default Flags', () => {
  test('should have all expected flags', () => {
    expect(DEFAULT_FLAGS.length).toBe(13);
    expect(DEFAULT_FLAG_MAP['fitness_ai_coach_enabled']).toBe(true);
    expect(DEFAULT_FLAG_MAP['budget_plaid_sync']).toBe(false);
    expect(DEFAULT_FLAG_MAP['meetings_real_time_transcription']).toBe(false);
    expect(DEFAULT_FLAG_MAP['global_onboarding_v2']).toBe(false);
  });
});

describe('Remote Config', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('getFeatureFlag returns cached value on second call', async () => {
    const { getFeatureFlag, clearCache } = require('../src/remote-config');
    clearCache();
    const val1 = await getFeatureFlag('fitness_ai_coach_enabled', false);
    expect(val1).toBe(true);
    // Second call should use cache
    const val2 = await getFeatureFlag('fitness_ai_coach_enabled', false);
    expect(val2).toBe(true);
  });

  test('getFeatureFlag returns default for unknown key', async () => {
    const { getFeatureFlag, clearCache } = require('../src/remote-config');
    clearCache();
    const val = await getFeatureFlag('nonexistent_flag', 'fallback');
    expect(val).toBe('fallback');
  });

  test('getAllFlags returns all flags', async () => {
    const { getAllFlags, clearCache } = require('../src/remote-config');
    clearCache();
    const flags = await getAllFlags();
    expect(flags['fitness_ai_coach_enabled']).toBe(true);
    expect(flags['budget_plaid_sync']).toBe(false);
  });
});

describe('A/B Testing', () => {
  test('assignVariant is deterministic', () => {
    const variants = ['control', 'variant_a', 'variant_b'];
    const v1 = assignVariant('exp-1', 'user-123', variants);
    const v2 = assignVariant('exp-1', 'user-123', variants);
    expect(v1).toBe(v2);
  });

  test('assignVariant distributes across variants', () => {
    const variants = ['control', 'treatment'];
    const results = new Set<string>();
    for (let i = 0; i < 100; i++) {
      results.add(assignVariant('exp-dist', `user-${i}`, variants));
    }
    expect(results.size).toBe(2);
  });

  test('different experiments give different assignments', () => {
    const variants = ['a', 'b', 'c', 'd'];
    // With enough variants and different experiment IDs, at least some users should differ
    let differs = false;
    for (let i = 0; i < 50; i++) {
      const v1 = assignVariant('exp-x', `user-${i}`, variants);
      const v2 = assignVariant('exp-y', `user-${i}`, variants);
      if (v1 !== v2) { differs = true; break; }
    }
    expect(differs).toBe(true);
  });

  test('throws on empty variants', () => {
    expect(() => assignVariant('exp-1', 'user-1', [])).toThrow('No variants');
  });
});

describe('Experiment Event Tracking', () => {
  test('trackExperimentEvent writes to Firestore', async () => {
    const admin = require('firebase-admin');
    const { trackExperimentEvent } = require('../src/ab-testing');

    const mockAdd = jest.fn().mockResolvedValue({ id: 'evt-1' });
    const mockCollection = jest.fn().mockReturnValue({ add: mockAdd });
    const mockDoc = jest.fn().mockReturnValue({
      get: jest.fn().mockResolvedValue({ exists: false }),
      collection: mockCollection,
    });
    admin.firestore.mockReturnValue({
      collection: jest.fn().mockReturnValue({ doc: mockDoc }),
    });

    await trackExperimentEvent('exp-1', 'user-1', 'click', 1);
    expect(mockAdd).toHaveBeenCalled();
  });
});

describe('Middleware', () => {
  test('featureGate returns 404 when flag is off', async () => {
    const { featureGate } = require('../src/middleware');
    const { clearCache } = require('../src/remote-config');
    clearCache();

    const req = { user: { uid: 'u1' } } as any;
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() } as any;
    const next = jest.fn();

    const gate = featureGate('budget_plaid_sync');
    await gate(req, res, next);
    // plaid_sync defaults to false
    expect(res.status).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();
  });

  test('featureGate calls next when flag is on', async () => {
    const { featureGate } = require('../src/middleware');
    const { clearCache } = require('../src/remote-config');
    clearCache();

    const req = { user: { uid: 'u1' } } as any;
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() } as any;
    const next = jest.fn();

    const gate = featureGate('fitness_ai_coach_enabled');
    await gate(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
