import Stripe from 'stripe';
import { IAMService } from './iam-service';
import { PLANS } from './plans';

// ---------------------------------------------------------------------------
// Stripe product → plan mapping (configure via env / remote config)
// ---------------------------------------------------------------------------

const STRIPE_PRODUCT_TO_PLAN: Record<string, string> = {
  prod_fitness_pro: 'fitness_pro',
  prod_nutrition_pro: 'nutrition_pro',
  prod_budget_pro: 'budget_pro',
  prod_meetings_pro: 'meetings_pro',
  prod_health_bundle: 'health_bundle',
  prod_all_access: 'all_access',
};

export interface IAMBillingConfig {
  stripe: Stripe;
  iamService: IAMService;
  webhookSecret: string;
  /** Map of Stripe product IDs → plan IDs (overrides defaults) */
  productToPlan?: Record<string, string>;
  /** Base URL for success/cancel redirects */
  baseUrl?: string;
}

export class IAMBilling {
  private stripe: Stripe;
  private iam: IAMService;
  private productToPlan: Record<string, string>;
  private baseUrl: string;

  constructor(private config: IAMBillingConfig) {
    this.stripe = config.stripe;
    this.iam = config.iamService;
    this.productToPlan = config.productToPlan ?? STRIPE_PRODUCT_TO_PLAN;
    this.baseUrl = config.baseUrl ?? 'https://crawfishlabs.ai';
  }

  // -----------------------------------------------------------------------
  // Webhook handlers
  // -----------------------------------------------------------------------

  async onSubscriptionCreated(subscription: Stripe.Subscription): Promise<void> {
    const uid = subscription.metadata.uid;
    if (!uid) return;

    const planId = this.resolvePlan(subscription);
    if (!planId) return;

    await this.iam.changePlan(uid, planId);
    await this.iam.updateUser(uid, {
      billingStatus: 'active',
      stripeCustomerId: subscription.customer as string,
    } as any);
  }

  async onSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
    const uid = subscription.metadata.uid;
    if (!uid) return;

    const planId = this.resolvePlan(subscription);
    if (!planId) return;

    await this.iam.changePlan(uid, planId);

    const status = subscription.status === 'active' ? 'active' : 'past_due';
    await this.iam.updateUser(uid, { billingStatus: status } as any);
  }

  async onSubscriptionCancelled(subscription: Stripe.Subscription): Promise<void> {
    const uid = subscription.metadata.uid;
    if (!uid) return;

    // Grace period: mark cancelled but keep pro features until period end
    const periodEnd = new Date(subscription.current_period_end * 1000);
    const now = new Date();

    if (periodEnd > now) {
      // Still in grace period
      await this.iam.updateUser(uid, { billingStatus: 'cancelled' } as any);
    } else {
      // Downgrade immediately
      await this.iam.changePlan(uid, 'free');
      await this.iam.updateUser(uid, { billingStatus: 'free' } as any);
    }
  }

  async onPaymentFailed(invoice: Stripe.Invoice): Promise<void> {
    const uid = invoice.metadata?.uid ?? (invoice.subscription_details as any)?.metadata?.uid;
    if (!uid) return;

    await this.iam.updateUser(uid, { billingStatus: 'past_due' } as any);

    // After 3 failures, downgrade
    const attemptCount = invoice.attempt_count ?? 0;
    if (attemptCount >= 3) {
      await this.iam.changePlan(uid, 'free');
      await this.iam.updateUser(uid, { billingStatus: 'free' } as any);
    }
  }

  // -----------------------------------------------------------------------
  // Checkout & Portal
  // -----------------------------------------------------------------------

  async createCheckoutSession(
    uid: string,
    planId: string,
    annual: boolean,
  ): Promise<{ url: string }> {
    const plan = PLANS[planId];
    if (!plan) throw new Error(`Unknown plan: ${planId}`);

    const user = await this.iam.getUser(uid);
    const priceAmount = annual ? plan.priceYearly : plan.priceMonthly;

    // Find or create Stripe price (in production, use pre-created price IDs)
    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      customer_email: user.stripeCustomerId ? undefined : user.email,
      customer: user.stripeCustomerId ?? undefined,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            unit_amount: Math.round(priceAmount * 100),
            recurring: { interval: annual ? 'year' : 'month' },
            product_data: { name: plan.name },
          },
          quantity: 1,
        },
      ],
      subscription_data: {
        metadata: { uid, planId },
      },
      success_url: `${this.baseUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${this.baseUrl}/checkout/cancel`,
    });

    return { url: session.url! };
  }

  async createPortalSession(uid: string): Promise<{ url: string }> {
    const user = await this.iam.getUser(uid);
    if (!user.stripeCustomerId) throw new Error('No Stripe customer');

    const session = await this.stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${this.baseUrl}/settings`,
    });

    return { url: session.url };
  }

  // -----------------------------------------------------------------------
  // Webhook verification & dispatch
  // -----------------------------------------------------------------------

  async handleWebhook(rawBody: Buffer, signature: string): Promise<void> {
    const event = this.stripe.webhooks.constructEvent(
      rawBody,
      signature,
      this.config.webhookSecret,
    );

    switch (event.type) {
      case 'customer.subscription.created':
        await this.onSubscriptionCreated(event.data.object as Stripe.Subscription);
        break;
      case 'customer.subscription.updated':
        await this.onSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;
      case 'customer.subscription.deleted':
        await this.onSubscriptionCancelled(event.data.object as Stripe.Subscription);
        break;
      case 'invoice.payment_failed':
        await this.onPaymentFailed(event.data.object as Stripe.Invoice);
        break;
    }
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private resolvePlan(subscription: Stripe.Subscription): string | undefined {
    // Check metadata first
    if (subscription.metadata.planId) return subscription.metadata.planId;

    // Fall back to product mapping
    const item = subscription.items.data[0];
    const productId = typeof item.price.product === 'string'
      ? item.price.product
      : (item.price.product as Stripe.Product).id;

    return this.productToPlan[productId];
  }
}
