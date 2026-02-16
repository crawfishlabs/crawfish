/**
 * @fileoverview Stripe Product and Price Configuration
 * @description Stripe products, prices, and webhook configuration for web subscriptions
 */

import Stripe from 'stripe';

export interface StripeProductConfig {
  id: string;
  name: string;
  description: string;
  metadata: {
    app: string;
    tier: string;
  };
}

export interface StripePriceConfig {
  id: string;
  product: string;
  unit_amount: number; // in cents
  currency: string;
  recurring: {
    interval: 'month' | 'year';
    interval_count: number;
  };
  metadata: {
    app: string;
    period: string;
  };
}

// Stripe product configurations
export const STRIPE_PRODUCTS: StripeProductConfig[] = [
  {
    id: 'prod_claw_fitness',
    name: 'Claw Fitness Pro',
    description: 'Advanced fitness tracking with AI-powered workout analysis and personalized coaching',
    metadata: {
      app: 'fitness',
      tier: 'pro'
    }
  },
  {
    id: 'prod_claw_nutrition',
    name: 'Claw Nutrition Pro',
    description: 'Smart meal tracking with AI food recognition and personalized nutrition insights',
    metadata: {
      app: 'nutrition',
      tier: 'pro'
    }
  },
  {
    id: 'prod_claw_meetings',
    name: 'Claw Meetings Pro',
    description: 'Intelligent meeting management with AI-powered summaries and action item tracking',
    metadata: {
      app: 'meetings',
      tier: 'pro'
    }
  },
  {
    id: 'prod_claw_budget',
    name: 'Claw Budget Pro',
    description: 'Comprehensive budget management with bank sync and smart categorization',
    metadata: {
      app: 'budget',
      tier: 'pro'
    }
  },
  {
    id: 'prod_claw_bundle',
    name: 'Claw Bundle Pro',
    description: 'Complete Claw suite - all four apps with significant savings',
    metadata: {
      app: 'bundle',
      tier: 'pro'
    }
  }
];

// Stripe price configurations
export const STRIPE_PRICES: StripePriceConfig[] = [
  // Fitness
  {
    id: 'price_fitness_monthly',
    product: 'prod_claw_fitness',
    unit_amount: 699, // $6.99
    currency: 'usd',
    recurring: {
      interval: 'month',
      interval_count: 1
    },
    metadata: {
      app: 'fitness',
      period: 'monthly'
    }
  },
  {
    id: 'price_fitness_yearly',
    product: 'prod_claw_fitness',
    unit_amount: 6999, // $69.99
    currency: 'usd',
    recurring: {
      interval: 'year',
      interval_count: 1
    },
    metadata: {
      app: 'fitness',
      period: 'yearly'
    }
  },

  // Nutrition
  {
    id: 'price_nutrition_monthly',
    product: 'prod_claw_nutrition',
    unit_amount: 699, // $6.99
    currency: 'usd',
    recurring: {
      interval: 'month',
      interval_count: 1
    },
    metadata: {
      app: 'nutrition',
      period: 'monthly'
    }
  },
  {
    id: 'price_nutrition_yearly',
    product: 'prod_claw_nutrition',
    unit_amount: 6999, // $69.99
    currency: 'usd',
    recurring: {
      interval: 'year',
      interval_count: 1
    },
    metadata: {
      app: 'nutrition',
      period: 'yearly'
    }
  },

  // Meetings
  {
    id: 'price_meetings_monthly',
    product: 'prod_claw_meetings',
    unit_amount: 999, // $9.99
    currency: 'usd',
    recurring: {
      interval: 'month',
      interval_count: 1
    },
    metadata: {
      app: 'meetings',
      period: 'monthly'
    }
  },
  {
    id: 'price_meetings_yearly',
    product: 'prod_claw_meetings',
    unit_amount: 9999, // $99.99
    currency: 'usd',
    recurring: {
      interval: 'year',
      interval_count: 1
    },
    metadata: {
      app: 'meetings',
      period: 'yearly'
    }
  },

  // Budget
  {
    id: 'price_budget_monthly',
    product: 'prod_claw_budget',
    unit_amount: 799, // $7.99
    currency: 'usd',
    recurring: {
      interval: 'month',
      interval_count: 1
    },
    metadata: {
      app: 'budget',
      period: 'monthly'
    }
  },
  {
    id: 'price_budget_yearly',
    product: 'prod_claw_budget',
    unit_amount: 7999, // $79.99
    currency: 'usd',
    recurring: {
      interval: 'year',
      interval_count: 1
    },
    metadata: {
      app: 'budget',
      period: 'yearly'
    }
  },

  // Bundle
  {
    id: 'price_bundle_monthly',
    product: 'prod_claw_bundle',
    unit_amount: 1999, // $19.99 (saves $11.96/month)
    currency: 'usd',
    recurring: {
      interval: 'month',
      interval_count: 1
    },
    metadata: {
      app: 'bundle',
      period: 'monthly'
    }
  },
  {
    id: 'price_bundle_yearly',
    product: 'prod_claw_bundle',
    unit_amount: 19999, // $199.99 (saves $119.96/year)
    currency: 'usd',
    recurring: {
      interval: 'year',
      interval_count: 1
    },
    metadata: {
      app: 'bundle',
      period: 'yearly'
    }
  }
];

// Webhook endpoint configurations
export const STRIPE_WEBHOOK_EVENTS = [
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_succeeded',
  'invoice.payment_failed',
  'invoice.upcoming',
  'customer.subscription.trial_will_end',
  'setup_intent.succeeded',
  'setup_intent.setup_failed'
];

export class StripeConfigManager {
  private stripe: Stripe;

  constructor() {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY environment variable is required');
    }
    
    this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2024-06-20',
    });
  }

  /**
   * Create all products and prices in Stripe (run once during setup)
   */
  async setupProducts(): Promise<void> {
    try {
      console.log('Setting up Stripe products and prices...');

      // Create products
      for (const productConfig of STRIPE_PRODUCTS) {
        try {
          await this.stripe.products.create({
            id: productConfig.id,
            name: productConfig.name,
            description: productConfig.description,
            metadata: productConfig.metadata
          });
          console.log(`Created product: ${productConfig.id}`);
        } catch (error: any) {
          if (error.code === 'resource_already_exists') {
            console.log(`Product already exists: ${productConfig.id}`);
          } else {
            throw error;
          }
        }
      }

      // Create prices
      for (const priceConfig of STRIPE_PRICES) {
        try {
          await this.stripe.prices.create({
            id: priceConfig.id,
            product: priceConfig.product,
            unit_amount: priceConfig.unit_amount,
            currency: priceConfig.currency,
            recurring: priceConfig.recurring,
            metadata: priceConfig.metadata
          });
          console.log(`Created price: ${priceConfig.id}`);
        } catch (error: any) {
          if (error.code === 'resource_already_exists') {
            console.log(`Price already exists: ${priceConfig.id}`);
          } else {
            throw error;
          }
        }
      }

      console.log('Stripe setup complete!');
    } catch (error) {
      console.error('Error setting up Stripe products:', error);
      throw error;
    }
  }

  /**
   * Create webhook endpoint
   */
  async createWebhookEndpoint(url: string): Promise<string> {
    try {
      const endpoint = await this.stripe.webhookEndpoints.create({
        url,
        enabled_events: STRIPE_WEBHOOK_EVENTS,
        metadata: {
          created_by: 'claw_platform',
          environment: process.env.NODE_ENV || 'development'
        }
      });

      console.log(`Created webhook endpoint: ${endpoint.id}`);
      console.log(`Webhook secret: ${endpoint.secret}`);
      
      return endpoint.secret!;
    } catch (error) {
      console.error('Error creating webhook endpoint:', error);
      throw error;
    }
  }

  /**
   * List all products and prices for verification
   */
  async listProductsAndPrices(): Promise<void> {
    try {
      const products = await this.stripe.products.list({ limit: 100 });
      const prices = await this.stripe.prices.list({ limit: 100 });

      console.log('Existing Stripe Products:');
      products.data.forEach(product => {
        console.log(`- ${product.id}: ${product.name}`);
      });

      console.log('\nExisting Stripe Prices:');
      prices.data.forEach(price => {
        const period = price.recurring?.interval === 'year' ? 'yearly' : 'monthly';
        const amount = price.unit_amount! / 100;
        console.log(`- ${price.id}: $${amount} ${period} (${price.product})`);
      });
    } catch (error) {
      console.error('Error listing products and prices:', error);
      throw error;
    }
  }

  /**
   * Update product or price (for maintenance)
   */
  async updateProduct(productId: string, updates: Partial<StripeProductConfig>): Promise<void> {
    try {
      await this.stripe.products.update(productId, {
        name: updates.name,
        description: updates.description,
        metadata: updates.metadata
      });
      console.log(`Updated product: ${productId}`);
    } catch (error) {
      console.error(`Error updating product ${productId}:`, error);
      throw error;
    }
  }

  /**
   * Deactivate old prices (can't delete, but can deactivate)
   */
  async deactivatePrice(priceId: string): Promise<void> {
    try {
      await this.stripe.prices.update(priceId, { active: false });
      console.log(`Deactivated price: ${priceId}`);
    } catch (error) {
      console.error(`Error deactivating price ${priceId}:`, error);
      throw error;
    }
  }

  /**
   * Get price by app and period
   */
  getPriceId(app: string, period: 'monthly' | 'yearly'): string | null {
    const price = STRIPE_PRICES.find(p => 
      p.metadata.app === app && p.metadata.period === period
    );
    return price?.id || null;
  }

  /**
   * Validate webhook signature
   */
  validateWebhookSignature(payload: string, signature: string): Stripe.Event {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      throw new Error('STRIPE_WEBHOOK_SECRET environment variable is required');
    }

    return this.stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  }
}