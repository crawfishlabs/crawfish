import { IAMBilling } from '../src/stripe-integration';
import Stripe from 'stripe';

// ---------------------------------------------------------------------------
// Mock IAMService
// ---------------------------------------------------------------------------

const mockIAM = {
  changePlan: jest.fn().mockResolvedValue(undefined),
  updateUser: jest.fn().mockResolvedValue(undefined),
  getUser: jest.fn().mockResolvedValue({
    uid: 'user-1',
    email: 'test@example.com',
    stripeCustomerId: 'cus_123',
  }),
} as any;

const mockStripe = {
  checkout: {
    sessions: { create: jest.fn().mockResolvedValue({ url: 'https://checkout.stripe.com/xyz' }) },
  },
  billingPortal: {
    sessions: { create: jest.fn().mockResolvedValue({ url: 'https://billing.stripe.com/xyz' }) },
  },
  webhooks: {
    constructEvent: jest.fn(),
  },
} as any;

let billing: IAMBilling;

beforeEach(() => {
  jest.clearAllMocks();
  billing = new IAMBilling({
    stripe: mockStripe,
    iamService: mockIAM,
    webhookSecret: 'whsec_test',
  });
});

describe('IAMBilling', () => {
  describe('onSubscriptionCreated', () => {
    it('upgrades user plan', async () => {
      await billing.onSubscriptionCreated({
        metadata: { uid: 'user-1', planId: 'fitness_pro' },
        customer: 'cus_123',
        items: { data: [{ price: { product: 'prod_fitness_pro' } }] },
      } as any);

      expect(mockIAM.changePlan).toHaveBeenCalledWith('user-1', 'fitness_pro');
      expect(mockIAM.updateUser).toHaveBeenCalledWith('user-1', expect.objectContaining({
        billingStatus: 'active',
      }));
    });

    it('ignores subscriptions without uid', async () => {
      await billing.onSubscriptionCreated({ metadata: {}, items: { data: [] } } as any);
      expect(mockIAM.changePlan).not.toHaveBeenCalled();
    });
  });

  describe('onSubscriptionCancelled', () => {
    it('marks as cancelled during grace period', async () => {
      await billing.onSubscriptionCancelled({
        metadata: { uid: 'user-1' },
        current_period_end: Math.floor(Date.now() / 1000) + 86400, // tomorrow
        items: { data: [{ price: { product: 'prod_fitness_pro' } }] },
      } as any);

      expect(mockIAM.updateUser).toHaveBeenCalledWith('user-1', expect.objectContaining({
        billingStatus: 'cancelled',
      }));
      expect(mockIAM.changePlan).not.toHaveBeenCalled();
    });

    it('downgrades to free after grace period', async () => {
      await billing.onSubscriptionCancelled({
        metadata: { uid: 'user-1' },
        current_period_end: Math.floor(Date.now() / 1000) - 86400, // yesterday
        items: { data: [{ price: { product: 'prod_fitness_pro' } }] },
      } as any);

      expect(mockIAM.changePlan).toHaveBeenCalledWith('user-1', 'free');
    });
  });

  describe('onPaymentFailed', () => {
    it('marks as past_due', async () => {
      await billing.onPaymentFailed({
        metadata: { uid: 'user-1' },
        attempt_count: 1,
      } as any);

      expect(mockIAM.updateUser).toHaveBeenCalledWith('user-1', expect.objectContaining({
        billingStatus: 'past_due',
      }));
    });

    it('downgrades after 3 failures', async () => {
      await billing.onPaymentFailed({
        metadata: { uid: 'user-1' },
        attempt_count: 3,
      } as any);

      expect(mockIAM.changePlan).toHaveBeenCalledWith('user-1', 'free');
    });
  });

  describe('createCheckoutSession', () => {
    it('creates a Stripe checkout session', async () => {
      const result = await billing.createCheckoutSession('user-1', 'fitness_pro', false);
      expect(result.url).toBe('https://checkout.stripe.com/xyz');
      expect(mockStripe.checkout.sessions.create).toHaveBeenCalled();
    });

    it('throws on unknown plan', async () => {
      await expect(billing.createCheckoutSession('user-1', 'nonexistent', false))
        .rejects.toThrow('Unknown plan');
    });
  });

  describe('createPortalSession', () => {
    it('creates a billing portal session', async () => {
      const result = await billing.createPortalSession('user-1');
      expect(result.url).toBe('https://billing.stripe.com/xyz');
    });
  });
});
