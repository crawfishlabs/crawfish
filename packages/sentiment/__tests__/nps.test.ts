import { NPSService, NPSStore } from '../src/nps';
import { SentimentResponse, SentimentMeta } from '../src/models';

function createMockNPSStore(overrides: Partial<NPSStore> = {}): NPSStore {
  return {
    getSentimentMeta: jest.fn().mockResolvedValue(null),
    setSentimentMeta: jest.fn().mockResolvedValue(undefined),
    saveResponse: jest.fn().mockResolvedValue(undefined),
    getRecentResponses: jest.fn().mockResolvedValue([]),
    getUserActionCount: jest.fn().mockResolvedValue(20),
    getUserActionCountForType: jest.fn().mockResolvedValue(10),
    createSupportTicket: jest.fn().mockResolvedValue(undefined),
    getNPSResponses: jest.fn().mockResolvedValue([]),
    getNPSResponsesByExperiment: jest.fn().mockResolvedValue([]),
    getUserDaysSinceInstall: jest.fn().mockResolvedValue(60),
    getUserMeaningfulActionCount: jest.fn().mockResolvedValue(20),
    getLastNPSDate: jest.fn().mockResolvedValue(null),
    ...overrides,
  };
}

function npsResponse(score: number, variant?: string): Partial<SentimentResponse> {
  return {
    id: `r-${Math.random()}`,
    userId: 'user1',
    appId: 'fitness',
    promptType: 'nps',
    npsScore: score,
    variant,
    timestamp: new Date(),
    dismissed: false,
  };
}

describe('NPSService', () => {
  describe('triggerNPS', () => {
    it('returns config for eligible user', async () => {
      const store = createMockNPSStore();
      const service = new NPSService(store);
      const config = await service.triggerNPS('user1', 'fitness');
      expect(config).not.toBeNull();
      expect(config!.appName).toBe('Claw Fitness');
      expect(config!.followUpPrompts.promoter).toBe('What do you love most?');
    });

    it('returns null for new user (<30 days)', async () => {
      const store = createMockNPSStore({ getUserDaysSinceInstall: jest.fn().mockResolvedValue(10) });
      const service = new NPSService(store);
      expect(await service.triggerNPS('user1', 'fitness')).toBeNull();
    });

    it('returns null for low-activity user (<10 actions)', async () => {
      const store = createMockNPSStore({ getUserMeaningfulActionCount: jest.fn().mockResolvedValue(5) });
      const service = new NPSService(store);
      expect(await service.triggerNPS('user1', 'fitness')).toBeNull();
    });

    it('returns null if NPS was taken within 90 days', async () => {
      const store = createMockNPSStore({
        getLastNPSDate: jest.fn().mockResolvedValue(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
      });
      const service = new NPSService(store);
      expect(await service.triggerNPS('user1', 'fitness')).toBeNull();
    });
  });

  describe('calculateNPS', () => {
    it('calculates correct NPS score', async () => {
      const responses = [
        npsResponse(10), npsResponse(9), npsResponse(9), // 3 promoters
        npsResponse(8), npsResponse(7),                    // 2 passives
        npsResponse(5), npsResponse(3), npsResponse(2), npsResponse(1), npsResponse(0), // 5 detractors
      ] as SentimentResponse[];

      const store = createMockNPSStore({ getNPSResponses: jest.fn().mockResolvedValue(responses) });
      const service = new NPSService(store);

      const result = await service.calculateNPS('fitness');
      expect(result.promoters).toBe(3);
      expect(result.passives).toBe(2);
      expect(result.detractors).toBe(5);
      // NPS = (3/10 - 5/10) * 100 = -20
      expect(result.score).toBe(-20);
      expect(result.totalResponses).toBe(10);
    });

    it('returns 0 for no responses', async () => {
      const store = createMockNPSStore();
      const service = new NPSService(store);
      const result = await service.calculateNPS('fitness');
      expect(result.score).toBe(0);
    });
  });

  describe('getNPSForExperiment', () => {
    it('compares NPS across variants', async () => {
      const responses = [
        // Control: mostly promoters
        ...Array(20).fill(null).map(() => npsResponse(9, 'control')),
        ...Array(10).fill(null).map(() => npsResponse(5, 'control')),
        // Treatment: mostly detractors
        ...Array(10).fill(null).map(() => npsResponse(9, 'treatment')),
        ...Array(20).fill(null).map(() => npsResponse(4, 'treatment')),
      ] as SentimentResponse[];

      const store = createMockNPSStore({
        getNPSResponsesByExperiment: jest.fn().mockResolvedValue(responses),
      });
      const service = new NPSService(store);

      const result = await service.getNPSForExperiment('exp1');
      expect(result.variants).toHaveLength(2);

      const control = result.variants.find(v => v.variantId === 'control')!;
      const treatment = result.variants.find(v => v.variantId === 'treatment')!;

      // Control: 20 promoters, 10 detractors = (20-10)/30 * 100 = 33
      expect(control.nps).toBe(33);
      // Treatment: 10 promoters, 20 detractors = (10-20)/30 * 100 = -33
      expect(treatment.nps).toBe(-33);
      expect(result.isSignificant).toBe(true);
    });
  });
});
