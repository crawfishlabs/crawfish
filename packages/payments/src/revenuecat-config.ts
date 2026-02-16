/**
 * @fileoverview RevenueCat Configuration for iOS/macOS Subscriptions
 * @description RevenueCat offerings, entitlements, and webhook configuration
 */

import axios from 'axios';

export interface RevenueCatOffering {
  identifier: string;
  description: string;
  metadata?: Record<string, any>;
  packages: RevenueCatPackage[];
}

export interface RevenueCatPackage {
  identifier: string;
  platform_product_identifier: string;
  display_name: string;
  position?: number;
}

export interface RevenueCatEntitlement {
  identifier: string;
  product_identifier: string;
}

export interface RevenueCatProduct {
  app_id: string;
  platform: 'ios' | 'mac_app_store' | 'android';
  store_product_identifier: string;
  type: 'subscription' | 'non_subscription' | 'consumable';
  subscription_duration?: string; // ISO 8601 duration (P1M, P1Y)
  subscription_grace_period_duration?: string;
  subscription_trial_duration?: string;
}

// RevenueCat offerings configuration
export const REVENUECAT_OFFERINGS: RevenueCatOffering[] = [
  {
    identifier: 'claw_fitness_offering',
    description: 'Claw Fitness Pro subscription plans',
    metadata: {
      app: 'fitness'
    },
    packages: [
      {
        identifier: 'fitness_monthly',
        platform_product_identifier: 'claw_fitness_monthly',
        display_name: 'Monthly',
        position: 1
      },
      {
        identifier: 'fitness_yearly',
        platform_product_identifier: 'claw_fitness_yearly',
        display_name: 'Yearly (Save 17%)',
        position: 2
      }
    ]
  },
  {
    identifier: 'claw_nutrition_offering',
    description: 'Claw Nutrition Pro subscription plans',
    metadata: {
      app: 'nutrition'
    },
    packages: [
      {
        identifier: 'nutrition_monthly',
        platform_product_identifier: 'claw_nutrition_monthly',
        display_name: 'Monthly',
        position: 1
      },
      {
        identifier: 'nutrition_yearly',
        platform_product_identifier: 'claw_nutrition_yearly',
        display_name: 'Yearly (Save 17%)',
        position: 2
      }
    ]
  },
  {
    identifier: 'claw_meetings_offering',
    description: 'Claw Meetings Pro subscription plans',
    metadata: {
      app: 'meetings'
    },
    packages: [
      {
        identifier: 'meetings_monthly',
        platform_product_identifier: 'claw_meetings_monthly',
        display_name: 'Monthly',
        position: 1
      },
      {
        identifier: 'meetings_yearly',
        platform_product_identifier: 'claw_meetings_yearly',
        display_name: 'Yearly (Save 17%)',
        position: 2
      }
    ]
  },
  {
    identifier: 'claw_budget_offering',
    description: 'Claw Budget Pro subscription plans',
    metadata: {
      app: 'budget'
    },
    packages: [
      {
        identifier: 'budget_monthly',
        platform_product_identifier: 'claw_budget_monthly',
        display_name: 'Monthly',
        position: 1
      },
      {
        identifier: 'budget_yearly',
        platform_product_identifier: 'claw_budget_yearly',
        display_name: 'Yearly (Save 17%)',
        position: 2
      }
    ]
  },
  {
    identifier: 'claw_bundle_offering',
    description: 'Claw Bundle - All apps with maximum savings',
    metadata: {
      app: 'bundle'
    },
    packages: [
      {
        identifier: 'bundle_monthly',
        platform_product_identifier: 'claw_bundle_monthly',
        display_name: 'Monthly Bundle',
        position: 1
      },
      {
        identifier: 'bundle_yearly',
        platform_product_identifier: 'claw_bundle_yearly',
        display_name: 'Yearly Bundle (Best Value)',
        position: 2
      }
    ]
  }
];

// RevenueCat entitlements - what users get access to
export const REVENUECAT_ENTITLEMENTS: RevenueCatEntitlement[] = [
  { identifier: 'fitness_pro', product_identifier: 'claw_fitness_monthly' },
  { identifier: 'fitness_pro', product_identifier: 'claw_fitness_yearly' },
  { identifier: 'nutrition_pro', product_identifier: 'claw_nutrition_monthly' },
  { identifier: 'nutrition_pro', product_identifier: 'claw_nutrition_yearly' },
  { identifier: 'meetings_pro', product_identifier: 'claw_meetings_monthly' },
  { identifier: 'meetings_pro', product_identifier: 'claw_meetings_yearly' },
  { identifier: 'budget_pro', product_identifier: 'claw_budget_monthly' },
  { identifier: 'budget_pro', product_identifier: 'claw_budget_yearly' },
  // Bundle gives access to all entitlements
  { identifier: 'fitness_pro', product_identifier: 'claw_bundle_monthly' },
  { identifier: 'nutrition_pro', product_identifier: 'claw_bundle_monthly' },
  { identifier: 'meetings_pro', product_identifier: 'claw_bundle_monthly' },
  { identifier: 'budget_pro', product_identifier: 'claw_bundle_monthly' },
  { identifier: 'fitness_pro', product_identifier: 'claw_bundle_yearly' },
  { identifier: 'nutrition_pro', product_identifier: 'claw_bundle_yearly' },
  { identifier: 'meetings_pro', product_identifier: 'claw_bundle_yearly' },
  { identifier: 'budget_pro', product_identifier: 'claw_bundle_yearly' },
];

// RevenueCat products for App Store Connect
export const REVENUECAT_PRODUCTS: RevenueCatProduct[] = [
  // iOS Products
  {
    app_id: 'claw_fitness_ios',
    platform: 'ios',
    store_product_identifier: 'claw_fitness_monthly',
    type: 'subscription',
    subscription_duration: 'P1M',
    subscription_trial_duration: 'P7D'
  },
  {
    app_id: 'claw_fitness_ios',
    platform: 'ios',
    store_product_identifier: 'claw_fitness_yearly',
    type: 'subscription',
    subscription_duration: 'P1Y',
    subscription_trial_duration: 'P7D'
  },
  {
    app_id: 'claw_nutrition_ios',
    platform: 'ios',
    store_product_identifier: 'claw_nutrition_monthly',
    type: 'subscription',
    subscription_duration: 'P1M',
    subscription_trial_duration: 'P7D'
  },
  {
    app_id: 'claw_nutrition_ios',
    platform: 'ios',
    store_product_identifier: 'claw_nutrition_yearly',
    type: 'subscription',
    subscription_duration: 'P1Y',
    subscription_trial_duration: 'P7D'
  },
  {
    app_id: 'claw_meetings_ios',
    platform: 'ios',
    store_product_identifier: 'claw_meetings_monthly',
    type: 'subscription',
    subscription_duration: 'P1M',
    subscription_trial_duration: 'P3D'
  },
  {
    app_id: 'claw_meetings_ios',
    platform: 'ios',
    store_product_identifier: 'claw_meetings_yearly',
    type: 'subscription',
    subscription_duration: 'P1Y',
    subscription_trial_duration: 'P3D'
  },
  {
    app_id: 'claw_budget_ios',
    platform: 'ios',
    store_product_identifier: 'claw_budget_monthly',
    type: 'subscription',
    subscription_duration: 'P1M',
    subscription_trial_duration: 'P14D'
  },
  {
    app_id: 'claw_budget_ios',
    platform: 'ios',
    store_product_identifier: 'claw_budget_yearly',
    type: 'subscription',
    subscription_duration: 'P1Y',
    subscription_trial_duration: 'P14D'
  },
  {
    app_id: 'claw_bundle_ios',
    platform: 'ios',
    store_product_identifier: 'claw_bundle_monthly',
    type: 'subscription',
    subscription_duration: 'P1M',
    subscription_trial_duration: 'P14D'
  },
  {
    app_id: 'claw_bundle_ios',
    platform: 'ios',
    store_product_identifier: 'claw_bundle_yearly',
    type: 'subscription',
    subscription_duration: 'P1Y',
    subscription_trial_duration: 'P14D'
  },

  // macOS Products (same identifiers but different app_id)
  {
    app_id: 'claw_fitness_macos',
    platform: 'mac_app_store',
    store_product_identifier: 'claw_fitness_monthly',
    type: 'subscription',
    subscription_duration: 'P1M',
    subscription_trial_duration: 'P7D'
  },
  {
    app_id: 'claw_fitness_macos',
    platform: 'mac_app_store',
    store_product_identifier: 'claw_fitness_yearly',
    type: 'subscription',
    subscription_duration: 'P1Y',
    subscription_trial_duration: 'P7D'
  },
  {
    app_id: 'claw_meetings_macos',
    platform: 'mac_app_store',
    store_product_identifier: 'claw_meetings_monthly',
    type: 'subscription',
    subscription_duration: 'P1M',
    subscription_trial_duration: 'P3D'
  },
  {
    app_id: 'claw_meetings_macos',
    platform: 'mac_app_store',
    store_product_identifier: 'claw_meetings_yearly',
    type: 'subscription',
    subscription_duration: 'P1Y',
    subscription_trial_duration: 'P3D'
  },
  {
    app_id: 'claw_budget_macos',
    platform: 'mac_app_store',
    store_product_identifier: 'claw_budget_monthly',
    type: 'subscription',
    subscription_duration: 'P1M',
    subscription_trial_duration: 'P14D'
  },
  {
    app_id: 'claw_budget_macos',
    platform: 'mac_app_store',
    store_product_identifier: 'claw_budget_yearly',
    type: 'subscription',
    subscription_duration: 'P1Y',
    subscription_trial_duration: 'P14D'
  }
];

// RevenueCat webhook events we care about
export const REVENUECAT_WEBHOOK_EVENTS = [
  'INITIAL_PURCHASE',
  'RENEWAL',
  'CANCELLATION',
  'UNCANCELLATION', 
  'NON_RENEWING_PURCHASE',
  'EXPIRATION',
  'BILLING_ISSUE',
  'PRODUCT_CHANGE',
  'TRANSFER'
];

export class RevenueCatConfigManager {
  private apiKey: string;
  private baseUrl = 'https://api.revenuecat.com/v1';

  constructor() {
    this.apiKey = process.env.REVENUECAT_API_KEY!;
    if (!this.apiKey) {
      throw new Error('REVENUECAT_API_KEY environment variable is required');
    }
  }

  /**
   * Setup RevenueCat offerings and entitlements (run once during setup)
   */
  async setupRevenueCat(): Promise<void> {
    try {
      console.log('Setting up RevenueCat offerings...');

      // Create projects for each app first (if needed)
      await this.createProjects();

      // Create offerings
      for (const offering of REVENUECAT_OFFERINGS) {
        await this.createOffering(offering);
      }

      // Create entitlements
      await this.createEntitlements();

      console.log('RevenueCat setup complete!');
    } catch (error) {
      console.error('Error setting up RevenueCat:', error);
      throw error;
    }
  }

  /**
   * Create RevenueCat projects for each app
   */
  private async createProjects(): Promise<void> {
    const projects = [
      { id: 'claw_fitness', name: 'Claw Fitness' },
      { id: 'claw_nutrition', name: 'Claw Nutrition' },
      { id: 'claw_meetings', name: 'Claw Meetings' },
      { id: 'claw_budget', name: 'Claw Budget' },
      { id: 'claw_bundle', name: 'Claw Bundle' }
    ];

    for (const project of projects) {
      try {
        await this.makeRequest('POST', '/projects', {
          name: project.name,
          project_id: project.id
        });
        console.log(`Created project: ${project.id}`);
      } catch (error: any) {
        if (error.response?.status === 409) {
          console.log(`Project already exists: ${project.id}`);
        } else {
          throw error;
        }
      }
    }
  }

  /**
   * Create an offering in RevenueCat
   */
  private async createOffering(offering: RevenueCatOffering): Promise<void> {
    try {
      await this.makeRequest('POST', '/offerings', {
        identifier: offering.identifier,
        description: offering.description,
        metadata: offering.metadata,
        packages: offering.packages
      });
      console.log(`Created offering: ${offering.identifier}`);
    } catch (error: any) {
      if (error.response?.status === 409) {
        console.log(`Offering already exists: ${offering.identifier}`);
      } else {
        throw error;
      }
    }
  }

  /**
   * Create entitlements in RevenueCat
   */
  private async createEntitlements(): Promise<void> {
    const uniqueEntitlements = Array.from(
      new Set(REVENUECAT_ENTITLEMENTS.map(e => e.identifier))
    );

    for (const entitlementId of uniqueEntitlements) {
      try {
        await this.makeRequest('POST', '/entitlements', {
          identifier: entitlementId,
          product_identifiers: REVENUECAT_ENTITLEMENTS
            .filter(e => e.identifier === entitlementId)
            .map(e => e.product_identifier)
        });
        console.log(`Created entitlement: ${entitlementId}`);
      } catch (error: any) {
        if (error.response?.status === 409) {
          console.log(`Entitlement already exists: ${entitlementId}`);
        } else {
          throw error;
        }
      }
    }
  }

  /**
   * Get subscriber info for a user
   */
  async getSubscriberInfo(appUserId: string): Promise<any> {
    return this.makeRequest('GET', `/subscribers/${appUserId}`);
  }

  /**
   * Grant promotional entitlement to a user
   */
  async grantPromotionalEntitlement(
    appUserId: string, 
    entitlementId: string, 
    duration: 'daily' | 'three_day' | 'weekly' | 'monthly' | 'two_month' | 'three_month' | 'six_month' | 'yearly'
  ): Promise<any> {
    return this.makeRequest('POST', `/subscribers/${appUserId}/entitlements/${entitlementId}/promotional`, {
      duration,
      start_time_ms: Date.now()
    });
  }

  /**
   * Revoke promotional entitlement
   */
  async revokePromotionalEntitlement(appUserId: string, entitlementId: string): Promise<any> {
    return this.makeRequest('POST', `/subscribers/${appUserId}/entitlements/${entitlementId}/revoke_promotional`);
  }

  /**
   * Update subscriber attributes (for analytics and targeting)
   */
  async updateSubscriberAttributes(appUserId: string, attributes: Record<string, any>): Promise<any> {
    return this.makeRequest('POST', `/subscribers/${appUserId}/attributes`, {
      attributes
    });
  }

  /**
   * List all active subscribers
   */
  async listActiveSubscribers(limit = 100, startingAfter?: string): Promise<any> {
    const params: any = { limit };
    if (startingAfter) {
      params.starting_after = startingAfter;
    }

    return this.makeRequest('GET', '/subscribers', null, params);
  }

  /**
   * Configure webhook URL
   */
  async configureWebhook(url: string, authorizationHeader?: string): Promise<void> {
    const config: any = {
      url,
      events: REVENUECAT_WEBHOOK_EVENTS
    };

    if (authorizationHeader) {
      config.authorization_header = authorizationHeader;
    }

    await this.makeRequest('POST', '/webhooks', config);
    console.log('Webhook configured successfully');
  }

  /**
   * Validate webhook signature
   */
  validateWebhookSignature(payload: string, signature: string): boolean {
    // RevenueCat uses HMAC-SHA256 for webhook signatures
    const crypto = require('crypto');
    const webhookSecret = process.env.REVENUECAT_WEBHOOK_SECRET;
    
    if (!webhookSecret) {
      console.warn('REVENUECAT_WEBHOOK_SECRET not configured');
      return false;
    }

    const computedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(payload)
      .digest('hex');

    return signature === computedSignature;
  }

  /**
   * Get offering by app
   */
  getOfferingByApp(app: string): RevenueCatOffering | null {
    return REVENUECAT_OFFERINGS.find(offering => 
      offering.metadata?.app === app
    ) || null;
  }

  /**
   * Get entitlement identifier by app
   */
  getEntitlementByApp(app: string): string {
    return `${app}_pro`;
  }

  /**
   * Map product identifier to app
   */
  getAppFromProductId(productId: string): string | null {
    if (productId.includes('fitness')) return 'fitness';
    if (productId.includes('nutrition')) return 'nutrition';
    if (productId.includes('meetings')) return 'meetings';
    if (productId.includes('budget')) return 'budget';
    if (productId.includes('bundle')) return 'bundle';
    return null;
  }

  /**
   * Make authenticated request to RevenueCat API
   */
  private async makeRequest(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    endpoint: string,
    data?: any,
    params?: any
  ): Promise<any> {
    try {
      const config: any = {
        method,
        url: `${this.baseUrl}${endpoint}`,
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'X-Platform': 'server'
        }
      };

      if (data) {
        config.data = data;
      }

      if (params) {
        config.params = params;
      }

      const response = await axios(config);
      return response.data;
    } catch (error: any) {
      console.error('RevenueCat API error:', error.response?.data || error.message);
      throw error;
    }
  }
}