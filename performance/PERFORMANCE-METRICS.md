# Performance Metrics and Thresholds

This document defines critical performance metrics and alert thresholds across all Claw applications.

## Universal Metrics (All Apps)

### API Performance
- **API Latency**
  - p50 < 200ms (CRITICAL)
  - p95 < 500ms (CRITICAL)
  - p99 < 1s (CRITICAL)
  - Alert at p95 > 400ms

### LLM Performance
- **LLM Response Time**
  - p50 < 2s
  - p95 < 5s
  - p99 < 10s
  - Alert at p95 > 4s

### Infrastructure
- **Cold Start** (Firebase Functions)
  - < 3s (CRITICAL)
  - Alert at > 2.5s
- **Error Rate**
  - < 0.5% (CRITICAL)
  - Alert at 0.3%
- **Crash-Free Rate**
  - > 99.5% (CRITICAL)
  - Alert at < 99.7%

### Resource Usage
- **Memory Usage** (Functions)
  - < 256MB per invocation
  - Alert at > 200MB
- **Firestore Reads**
  - < 10 per user action (cost optimization)
  - Alert at > 8 per action

### Client Metrics
- **Bundle Size**
  - iOS < 50MB
  - Web < 500KB initial JS
  - Alert at iOS > 45MB, Web > 450KB

## ClawFitness Specific Metrics

### Critical User Paths
- **Rest Timer Accuracy**
  - drift < 100ms (CRITICAL — users depend on precise timing)
  - Alert at drift > 80ms
- **Workout Log Save**
  - < 500ms (CRITICAL — mid-set reliability)
  - Alert at > 400ms
- **Exercise Search**
  - < 200ms (UX critical)
  - Alert at > 150ms
- **Coach Response Start**
  - < 1.5s streaming first token
  - Alert at > 1.2s

### App-Specific Metrics
- **Workout Sync Time**: < 2s for full workout upload
- **Timer Precision**: ±50ms for rest/work intervals
- **Exercise Video Load**: < 1s for first frame

## Claw Nutrition Specific Metrics

### Core Features
- **Photo Scan → Result**
  - < 4s total (CRITICAL — core UX)
  - Alert at > 3.5s
- **Barcode Lookup**
  - < 1s (CRITICAL)
  - Alert at > 800ms
- **Food Search**
  - < 300ms
  - Alert at > 250ms
- **Daily Dashboard Load**
  - < 1s with full macro data
  - Alert at > 800ms

### App-Specific Metrics
- **Photo Processing**: < 2s for ML analysis
- **Database Lookup**: < 500ms for food item retrieval
- **Macro Calculation**: < 100ms for daily totals

## Claw Meetings Specific Metrics

### Core Workflows
- **Recording Start**
  - < 500ms (CRITICAL — can't miss meeting start)
  - Alert at > 400ms
- **Transcription Latency**
  - < 30s per minute of audio (CRITICAL)
  - Alert at > 25s per minute
- **Meeting Analysis**
  - < 60s for 30min meeting (after transcription)
  - Alert at > 45s for 30min meeting
- **Search Across Meetings**
  - < 2s for NL query
  - Alert at > 1.5s

### App-Specific Metrics
- **Audio Upload**: Reliable on poor WiFi with retry/resume
- **Real-time Transcription**: < 5s lag during live meetings
- **Meeting Summary Generation**: < 2min for 1hr meeting

## Claw Budget Specific Metrics

### Critical Features
- **Budget View Load**
  - < 500ms with all categories (CRITICAL — YNAB is fast here)
  - Alert at > 400ms
- **Transaction Save**
  - < 300ms (CRITICAL — quick entry is core UX)
  - Alert at > 250ms
- **Category Assignment**
  - < 100ms (inline editing must feel instant)
  - Alert at > 80ms

### Financial Operations
- **Receipt Scan → Parse**
  - < 5s (photo to structured data)
  - Alert at > 4s
- **Bank Sync (Plaid)**
  - < 10s per account refresh
  - Alert at > 8s
- **Report Generation**
  - < 2s for any report view
  - Alert at > 1.5s

### App-Specific Metrics
- **Balance Calculation**: < 200ms for account totals
- **Category Filtering**: < 150ms for transaction lists
- **Export Generation**: < 5s for CSV/PDF exports

## Alert Severity Levels

### Critical Alerts (Immediate Action Required)
- API errors > 1%
- Core feature failure (scan, save, start recording)
- Memory usage > 90% of limit
- Cold starts > 5s

### Warning Alerts (Monitor Closely)
- Performance degradation > 20%
- Error rate > 0.3%
- Resource usage > 80%
- Response time approaching thresholds

### Info Alerts (Trend Analysis)
- Performance improvement detected
- Usage pattern changes
- Resource optimization opportunities

## Monitoring Implementation

### Data Collection
- Firebase Performance Monitoring (automatic)
- Custom performance SDK (app-specific metrics)
- Real User Monitoring (RUM)
- Synthetic monitoring for critical paths

### Alert Channels
1. **Firestore** (for dashboard display)
2. **Telegram** (immediate alerts to Sam)
3. **Email** (summary reports)
4. **Slack** (team notifications - future)

### Measurement Windows
- **Real-time**: 1-minute moving average
- **Short-term**: 5-minute and 1-hour windows
- **Daily**: 24-hour aggregations
- **Weekly**: 7-day trends

## Performance Budget

Each app has a "performance budget" — if any critical metric exceeds threshold:
1. **Automatic**: Create performance issue in backlog
2. **Warning**: Block non-critical deployments
3. **Critical**: Block ALL deployments until fixed

This ensures performance regressions are caught early and never reach users.