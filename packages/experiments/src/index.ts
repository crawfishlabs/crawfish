// TODO(@claw/core migration): Replace direct firebase-admin imports with @claw/core adapters:
//   - engine.ts: firestore reads/writes → CrawfishStore adapter
//   - feedback-loop.ts: firestore triggers → CrawfishEventBus adapter
//   - reports.ts: firestore queries → CrawfishStore.query
//   - middleware.ts: auth verification → CrawfishAuth adapter

export * from './models';
export * from './engine';
export * from './statistics';
export * from './reports';
export * from './feedback-loop';
export * from './middleware';
export * from './presets';
export { createExperimentRoutes } from './routes';
