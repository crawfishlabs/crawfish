// ============================================================================
// Apple HealthKit Provider — Device-Side Permission (Pattern E)
//
// HealthKit is fundamentally different from OAuth providers:
// - Data lives on the user's iPhone, not on a server
// - Permission is granted via iOS system dialog, not OAuth
// - No server-stored access token — the iOS app reads data directly
// - The broker tracks the connection for UI consistency and audit
//
// This provider handles:
// 1. Registering that a user has granted HealthKit access (from the iOS app)
// 2. Receiving synced health data from the iOS app
// 3. Revoking the connection (tells iOS app to stop syncing)
//
// The iOS app is responsible for:
// - Requesting HealthKit authorization (HKHealthStore.requestAuthorization)
// - Reading data (HKSampleQuery, HKStatisticsQuery, etc.)
// - Syncing to the broker via POST /v1/sync/healthkit
// ============================================================================

import type { ServiceConfig, ServiceCredential, ApprovalCallback } from '../types.js';
import { BaseServiceProvider } from './base.js';

/** HealthKit data types the app can request access to */
export const HEALTHKIT_DATA_TYPES = {
  // Activity
  steps: 'HKQuantityTypeIdentifierStepCount',
  distance: 'HKQuantityTypeIdentifierDistanceWalkingRunning',
  activeEnergy: 'HKQuantityTypeIdentifierActiveEnergyBurned',
  exerciseMinutes: 'HKQuantityTypeIdentifierAppleExerciseTime',

  // Workouts
  workouts: 'HKWorkoutType',

  // Heart
  heartRate: 'HKQuantityTypeIdentifierHeartRate',
  restingHeartRate: 'HKQuantityTypeIdentifierRestingHeartRate',
  hrv: 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN',

  // Body
  weight: 'HKQuantityTypeIdentifierBodyMass',
  bodyFat: 'HKQuantityTypeIdentifierBodyFatPercentage',
  height: 'HKQuantityTypeIdentifierHeight',

  // Sleep
  sleep: 'HKCategoryTypeIdentifierSleepAnalysis',

  // Nutrition
  dietaryEnergy: 'HKQuantityTypeIdentifierDietaryEnergyConsumed',
  dietaryProtein: 'HKQuantityTypeIdentifierDietaryProtein',
  dietaryCarbs: 'HKQuantityTypeIdentifierDietaryCarbohydrates',
  dietaryFat: 'HKQuantityTypeIdentifierDietaryFatTotal',
} as const;

export type HealthKitScope = keyof typeof HEALTHKIT_DATA_TYPES;

export interface HealthKitConnectionData {
  /** No token — just metadata about the connection */
  device_id: string;
  device_model?: string;
  ios_version?: string;
  /** Which data types the user authorized */
  authorized_types: HealthKitScope[];
  /** Last successful sync timestamp */
  last_sync?: string;
  /** Sync status */
  sync_enabled: boolean;
}

export class AppleHealthProvider extends BaseServiceProvider {
  readonly name = 'apple-health';
  readonly requiredScopes: HealthKitScope[] = ['steps', 'workouts', 'heartRate', 'weight'];

  /**
   * HealthKit doesn't use OAuth. This method registers that the user
   * has granted permission on their device.
   *
   * Called by the iOS app after HKHealthStore.requestAuthorization succeeds.
   */
  async authenticate(_config: ServiceConfig, _approve: ApprovalCallback): Promise<ServiceCredential> {
    throw new Error(
      'Apple HealthKit uses device-side permission, not OAuth. ' +
      'Use registerDeviceConnection() after the iOS app obtains permission.'
    );
  }

  /**
   * Register that a user has granted HealthKit access on their device.
   * Called by the iOS app after successful HKHealthStore.requestAuthorization.
   */
  registerDeviceConnection(opts: {
    deviceId: string;
    deviceModel?: string;
    iosVersion?: string;
    authorizedTypes: HealthKitScope[];
  }): ServiceCredential {
    const data: HealthKitConnectionData = {
      device_id: opts.deviceId,
      device_model: opts.deviceModel,
      ios_version: opts.iosVersion,
      authorized_types: opts.authorizedTypes,
      sync_enabled: true,
    };

    return this.makeCredential('session', data as any);
  }

  /**
   * Test: check if we've received recent data from the device.
   */
  async test(credential: ServiceCredential): Promise<{ valid: boolean; info?: string }> {
    const data = credential.data as unknown as HealthKitConnectionData;
    if (!data.sync_enabled) {
      return { valid: false, info: 'Sync disabled' };
    }
    if (data.last_sync) {
      const age = Date.now() - new Date(data.last_sync).getTime();
      if (age > 48 * 3600000) {
        return { valid: false, info: `Last sync: ${data.last_sync} (>48h ago, may be stale)` };
      }
      return {
        valid: true,
        info: `Device: ${data.device_model || data.device_id}, last sync: ${data.last_sync}, types: ${data.authorized_types.join(', ')}`,
      };
    }
    return { valid: true, info: `Connected (${data.device_model || data.device_id}), awaiting first sync` };
  }

  /**
   * Revoke: mark sync as disabled. The iOS app should check this
   * and stop reading/syncing HealthKit data.
   */
  async revoke(credential: ServiceCredential): Promise<boolean> {
    // Server-side: we can only mark it as disabled.
    // Actual HealthKit permission can only be revoked by the user in iOS Settings.
    // The iOS app should check the broker for revocation and stop syncing.
    return true;
  }

  /**
   * Update the last sync timestamp. Called by the iOS app after a successful data sync.
   */
  updateSyncTimestamp(credential: ServiceCredential): ServiceCredential {
    const data = credential.data as unknown as HealthKitConnectionData;
    data.last_sync = new Date().toISOString();
    return credential;
  }
}
