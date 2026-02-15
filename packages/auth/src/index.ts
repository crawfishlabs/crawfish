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