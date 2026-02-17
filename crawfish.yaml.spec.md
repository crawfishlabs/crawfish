# crawfish.yaml Specification

Every Crawfish-connected project has a `crawfish.yaml` in the repo root. This file configures how Crawfish interacts with the project.

## Full Schema

```yaml
# Required. Schema version.
version: 1

# Required. Your Crawfish app ID.
app_id: app_xxx

# Required. API key for authentication.
api_key: ck_xxx

# Repository configuration.
repo:
  provider: github | gitlab | bitbucket     # Required
  owner: string                              # Required — org or user
  name: string                               # Required — repo name
  base_branch: main                          # Default: main

# Event ingestion settings.
events:
  endpoint: https://api.crawfish.dev/v1/events   # Default
  batch_size: 10                                  # Events per batch (1-100)
  flush_interval_ms: 5000                         # Flush timer in ms
  ignored_events: []                              # Event types to skip

# Feature flag configuration.
flags:
  provider: crawfish | launchdarkly | statsig | optimizely | custom
  endpoint: https://api.crawfish.dev/v1/flags    # For crawfish provider
  sdk_key: string                                 # For external providers
  custom_endpoint: string                         # For custom provider

# Fix generation settings.
fixes:
  auto_pr: true                    # Create PRs automatically
  base_branch: main                # Target branch for PRs
  labels: ["crawfish-fix"]         # Labels to add to PRs
  require_approval: true           # Require human approval before merge
  max_open_prs: 5                  # Max concurrent open fix PRs
  file_patterns:                   # Files Crawfish is allowed to modify
    - "src/**"
    - "prompts/**"
    - "config/**"
  ignore_patterns:                 # Files Crawfish must never touch
    - "*.lock"
    - ".env*"

# Experiment configuration.
experiments:
  min_sample_size: 100             # Minimum users before concluding
  confidence_level: 0.95           # Statistical significance threshold
  max_duration_days: 14            # Auto-conclude after this
  primary_metric: string           # Default success metric
  guardrail_metrics: []            # Metrics that must not regress

# Integration configuration.
integrations:
  sentry:
    dsn: string                    # Sentry DSN for error forwarding
  intercom:
    app_id: string                 # Intercom app ID
  zendesk:
    subdomain: string
    api_token: string
  app_store:
    apple_id: string               # Apple App Store app ID
    google_package: string          # Google Play package name
    poll_interval_hours: 6          # How often to check for new reviews

# Guardrail configuration.
guardrails:
  enabled: true
  rules:
    - name: string
      type: content | format | length | custom
      config: Record<string, any>
  alert_on_violation: true
  block_on_violation: false

# Environment overrides.
environments:
  production:
    events:
      endpoint: https://api.crawfish.dev/v1/events
  staging:
    events:
      endpoint: https://staging-api.crawfish.dev/v1/events
    fixes:
      auto_pr: false
```

## Minimal Example

```yaml
version: 1
app_id: app_xxx
api_key: ck_xxx
repo:
  provider: github
  owner: myorg
  name: myapp
```

## Notes

- `api_key` should be stored as a CI/CD secret, not committed. Use `CRAWFISH_API_KEY` env var as fallback.
- The SDK reads `crawfish.yaml` automatically if present, but config can also be passed programmatically.
- Environment overrides deep-merge with the base config.
