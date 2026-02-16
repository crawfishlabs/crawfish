# Claw Performance Monitoring Infrastructure

This directory contains the comprehensive performance monitoring infrastructure for all Claw applications, including autonomous optimization capabilities.

## 🏗️ Architecture Overview

```
Performance Infrastructure
├── 📊 Metrics Collection (Firebase + Custom)
├── 🔔 Real-time Alerting (Telegram + Dashboard)
├── 🤖 Autonomous Optimization (LLM-powered)
├── 📱 iOS SDK (Swift)
├── 🧪 Benchmarking (CI/CD Integration)
└── 📈 Performance Dashboard
```

## 📁 Directory Structure

```
performance/
├── PERFORMANCE-METRICS.md    # Critical metrics and thresholds per app
├── auto-optimize.ts           # Autonomous optimization system
├── benchmark.ts              # Performance benchmarking suite
├── baselines/                # Performance baselines per app
│   ├── claw-fitness.json
│   ├── claw-nutrition.json
│   ├── claw-meetings.json
│   ├── claw-budget.json
│   └── claw-web.json
├── jobs/                     # Scheduled monitoring jobs
│   ├── metric-collector.ts   # Aggregates metrics every 6h
│   ├── performance-review.ts # Daily LLM analysis
│   └── auto-fix.ts          # Autonomous fix deployment
└── swift/                   # iOS Performance SDK
    └── ClawPerformance.swift
```

## 🚀 Quick Start

### 1. Install Dependencies

```bash
cd performance/
npm install
npm run build
```

### 2. Set Up Firebase Admin

Ensure Firebase Admin SDK is configured with proper credentials.

### 3. Run Benchmarks

```bash
# Run benchmarks for a specific app
npm run start:benchmark claw-fitness

# Run in CI mode (fails on regression)
CI=true npm run start:benchmark claw-fitness
```

### 4. Start Monitoring Jobs

```bash
# Collect and aggregate metrics
npm run start:metric-collector

# Generate daily performance report
npm run start:performance-review

# Run autonomous optimization
npm run start:auto-fix
```

## 📊 Performance Metrics

### Universal Metrics (All Apps)
- **API Latency**: p95 < 500ms (CRITICAL)
- **LLM Response Time**: p95 < 5s
- **Cold Start**: < 3s (CRITICAL)
- **Error Rate**: < 0.5% (CRITICAL)
- **Memory Usage**: < 256MB per function

### App-Specific Metrics

#### ClawFitness
- **Rest Timer Accuracy**: < 100ms drift (CRITICAL)
- **Workout Log Save**: < 500ms (CRITICAL)
- **Exercise Search**: < 200ms

#### Claw Nutrition
- **Photo Scan → Result**: < 4s (CRITICAL)
- **Barcode Lookup**: < 1s (CRITICAL)
- **Food Search**: < 300ms

#### Claw Meetings
- **Recording Start**: < 500ms (CRITICAL)
- **Transcription Latency**: < 30s per minute (CRITICAL)
- **Meeting Search**: < 2s

#### Claw Budget
- **Budget View Load**: < 500ms (CRITICAL)
- **Transaction Save**: < 300ms (CRITICAL)
- **Category Assignment**: < 100ms

See `PERFORMANCE-METRICS.md` for complete specifications.

## 🔔 Alerting System

### Alert Levels
- **INFO**: Performance improvements detected
- **WARNING**: Approaching thresholds (>80%)
- **CRITICAL**: Exceeded thresholds, action required

### Alert Channels
1. **Firestore**: Dashboard display (`_performance_alerts`)
2. **Telegram**: Immediate notifications to Sam
3. **Email**: Summary reports (future)
4. **GitLab**: Block deployments on critical regressions

### Alert Examples
```
🚨 CRITICAL: claw-fitness workout_log_save exceeded 500ms (actual: 847ms)
⚠️  WARNING: claw-nutrition photo_scan_result approaching 4s limit (actual: 3.7s)
✅ INFO: claw-budget transaction_save improved by 15% (250ms → 210ms)
```

## 🤖 Autonomous Optimization

The system automatically detects performance regressions and generates fixes:

### Detection Process
1. **Monitor**: Continuous metric collection
2. **Compare**: Against baselines and thresholds
3. **Analyze**: LLM-powered root cause analysis
4. **Fix**: Generate code/config changes
5. **Deploy**: Auto-merge low-risk fixes
6. **Verify**: Measure effectiveness after 24h

### Auto-Fix Categories
- **Database**: Add indexes, optimize queries
- **Cache**: Implement Redis, cache-aside patterns
- **Algorithm**: Optimize processing logic
- **Infrastructure**: Adjust memory, timeouts
- **Bundle**: Code splitting, lazy loading

### Decision Matrix
| Impact | Complexity | Action |
|--------|------------|--------|
| Low (<30%) | Low | Auto-merge |
| Medium (30-75%) | Low-Medium | Create MR, notify Sam |
| High (>75%) | Any | Block deployments, urgent alert |

## 📱 iOS Performance Monitoring

### Integration

```swift
import ClawPerformance

// Start monitoring
ClawPerformance.shared.setupPerformanceMonitoring()

// Measure operations
ClawPerformance.shared.startTrace(name: "workout_save")
// ... perform operation
ClawPerformance.shared.endTrace(name: "workout_save", success: true)

// App-specific measurements
ClawPerformance.shared.recordRestTimerAccuracy(expectedMs: 1000, actualMs: 1050)
ClawPerformance.shared.startPhotoScanTrace()
```

### Automatic Monitoring
- App launch time
- Screen render time (Time to Interactive)
- Memory usage and frame rate
- Network calls
- Battery impact
- Offline queue depth

## 🧪 Benchmarking

### Running Benchmarks

```bash
# Run all benchmarks for an app
node benchmark.js claw-fitness

# Run specific benchmark
node benchmark.js claw-fitness --benchmark workout_log_save

# CI mode (fails on >10% regression)
CI=true node benchmark.js claw-fitness
```

### Benchmark Results

Results are saved to `perf-results.json`:

```json
{
  "app": "claw-fitness",
  "results": [
    {
      "name": "workout_log_save",
      "avg": 245.6,
      "p95": 389.2,
      "success": true,
      "iterations": 10
    }
  ],
  "regressions": []
}
```

## 🔧 CI/CD Integration

### GitLab CI Stages

Each app now includes performance stages:

```yaml
performance:benchmark:
  stage: performance
  script:
    - node ../claw-platform/performance/benchmark.js claw-fitness

performance:regression-check:
  stage: performance
  script:
    - node ../claw-platform/performance/auto-optimize.js --check-only
  allow_failure: false  # Block on critical regression
```

### Performance Budget

If any critical metric exceeds threshold:
1. **Warning**: Block non-critical deployments
2. **Critical**: Block ALL deployments
3. **Auto-fix**: Create optimization MR

## 📈 Performance Dashboard

### Real-time Metrics
- Current performance across all apps
- Active alerts and their severity
- Recent optimizations and their effectiveness

### Historical Analysis
- Performance trends over time
- Regression detection and resolution
- Cost analysis (LLM usage, infrastructure)

### Firestore Collections
- `_performance_metrics`: Raw performance data
- `_performance_alerts`: Active and resolved alerts
- `_performance_summaries`: Aggregated daily/hourly data
- `_performance_optimizations`: Auto-generated fixes
- `_daily_reports`: LLM-generated analysis

## 🛠️ Development

### Adding New Metrics

1. **Define thresholds** in `PERFORMANCE-METRICS.md`
2. **Add to baseline** files in `baselines/`
3. **Update alert system** in `performance-alerts.ts`
4. **Add benchmark** in `benchmark.ts`
5. **Update CI/CD** to check the metric

### Adding New Optimizations

1. **Create detector** in `auto-optimize.ts`
2. **Define fix template** for the issue type
3. **Add verification logic**
4. **Test with staging environment**

### Local Testing

```bash
# Test specific components
npm run test

# Run local performance review
npm run start:performance-review

# Test benchmark suite
npm run start:benchmark claw-fitness
```

## 📋 Scheduled Jobs

### Metric Collector (Every 6 hours)
- Aggregates raw performance data
- Generates trend analysis
- Cleans up old data
- Powers dashboard summaries

### Performance Review (Daily)
- LLM-powered performance analysis
- Identifies slow degradations
- Generates optimization recommendations
- Creates weekly reports

### Auto-Fix (Every 6 hours)
- Checks for threshold breaches
- Runs optimization detection
- Creates and merges fixes
- Verifies effectiveness

## 🚨 Emergency Procedures

### Performance Incident Response

1. **Immediate**: Check `_performance_alerts` for active issues
2. **Assess**: Review recent deployments and changes
3. **Rollback**: Use GitLab CI rollback job if needed
4. **Fix**: Address root cause, deploy fix
5. **Monitor**: Verify resolution across all metrics

### Rollback Commands

```bash
# Emergency rollback via GitLab CI
gitlab-ci rollback:production

# Manual rollback
firebase use clawapp-prod
firebase functions:delete problematicFunction
firebase deploy --only functions:goodFunction
```

## 🔍 Troubleshooting

### Common Issues

**High latency alerts**
- Check recent deployments
- Review infrastructure changes
- Examine database query patterns

**False positive alerts**
- Verify baseline accuracy
- Check for testing traffic
- Review metric collection logic

**Auto-optimization failures**
- Check LLM API quotas
- Verify Git permissions
- Review code generation logic

### Debug Commands

```bash
# Check recent metrics
npm run start:metric-collector -- --debug

# Test alert system
npm run start:auto-fix -- --dry-run

# Validate benchmarks
npm run start:benchmark -- --validate-only
```

## 📞 Support

For issues with the performance monitoring infrastructure:

1. **Check logs** in Firestore collections
2. **Review alerts** in dashboard
3. **Contact team** via Telegram
4. **Create issue** in GitLab repository

## 🚀 Future Enhancements

- **Machine Learning**: Predictive performance modeling
- **Cross-app Analysis**: Shared optimization insights
- **User Impact Correlation**: Link performance to business metrics
- **Advanced Alerting**: Slack, PagerDuty integration
- **Performance Budgets**: Automatic resource allocation

---

*This infrastructure ensures Claw apps maintain excellent performance while automatically detecting and fixing issues before they impact users.*