// TODO(@claw/core migration): Replace direct firebase-admin imports with @claw/core adapters:
//   - collector.ts: SentimentStore (firestore) → CrawfishStore adapter
//   - nps.ts: NPSStore (firestore) → CrawfishStore adapter
//   - analytics.ts: AnalyticsStore (firestore) → CrawfishStore adapter
//   - experiment-integration.ts: firestore triggers → CrawfishEventBus adapter

export * from './models';
export { SentimentCollector, SentimentStore, ExperimentFeedbackSink } from './collector';
export { NPSService, NPSStore } from './nps';
export { SentimentAnalytics, AnalyticsStore } from './analytics';
export { SENTIMENT_METRICS, SENTIMENT_GUARDRAILS, withSentimentGuardrails } from './experiment-integration';
