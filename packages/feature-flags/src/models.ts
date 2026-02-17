export type FlagType = 'boolean' | 'string' | 'number' | 'json';

export interface FeatureFlag {
  key: string;
  value: any;
  type: FlagType;
  description?: string;
  /** Per-user overrides: userId -> value */
  userOverrides?: Record<string, any>;
}

export type ExperimentStatus = 'draft' | 'active' | 'completed';

export interface Experiment {
  id: string;
  name: string;
  variants: string[];
  status: ExperimentStatus;
  startDate?: Date;
  endDate?: Date;
  /** Percentage of users included (0-100) */
  targetPercentage: number;
}

export interface Variant {
  name: string;
  weight?: number;
}

export interface ExperimentEvent {
  id: string;
  experimentId: string;
  userId: string;
  variant: string;
  event: string;
  value?: number;
  timestamp: Date;
}

export interface VariantResults {
  variant: string;
  userCount: number;
  eventCount: number;
  totalValue: number;
  averageValue: number;
}

export interface ExperimentResults {
  experimentId: string;
  experiment: Experiment;
  variants: VariantResults[];
  totalUsers: number;
  totalEvents: number;
}
