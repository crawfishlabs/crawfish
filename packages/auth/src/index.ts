/**
 * @fileoverview Claw Platform Authentication Module
 * @description Firebase Authentication middleware and user management utilities
 */

export { authMiddleware, optionalAuthMiddleware, AuthenticatedRequest } from './middleware';
export { createUserHook } from './hooks';
export { 
  UserRole, 
  hasRole, 
  requireRole, 
  getRolePermissions,
  upgradeUserRole,
  downgradeUserRole 
} from './roles';

// OAuth Integrations
export {
  IntegrationConnection,
  CalendarEvent,
  Calendar,
  ZoomMeeting,
  ZoomRecording,
  StripeFinancialConnectionsAccount,
  StripeTransaction,
  TransactionSync,
  StripeFinancialConnectionsSession,
  Institution,
  GoogleIntegration,
  ZoomIntegration,
  StripeFinancialConnectionsIntegration,
  SlackIntegration,
  IntegrationManager
} from './integrations';

// Token Encryption
export { TokenEncryption, TokenKeyUtils } from './token-encryption';

// Integration Routes
export { default as integrationRoutes } from './integration-routes';