// @claw/iam — Unified Identity & Access Management
//
// TODO(@claw/core migration): Replace direct firebase-admin imports with @claw/core adapters:
//   - iam-service.ts: firebase-admin/auth → CrawfishAuth adapter
//   - iam-service.ts: firebase-admin/firestore → CrawfishStore adapter
//   - middleware.ts: firebase-admin/auth.verifyIdToken → CrawfishAuth.verifyToken
//   - stripe-integration.ts: firestore for subscription storage → CrawfishStore
export * from './models';
export * from './plans';
export { IAMService, IAMConfig } from './iam-service';
export { createIAMMiddleware } from './middleware';
export { IAMBilling, IAMBillingConfig } from './stripe-integration';
export { createIAMRoutes, IAMRoutesConfig } from './routes';
