# Claw Security Policy

## Overview

This document defines the security policy for all Claw applications and the shared platform. All apps must adhere to these standards.

## Dependency Scanning

- **Schedule**: Weekly automated scans on Sundays at 2:00 AM UTC
- **Tools**: npm audit, Snyk, OWASP Dependency Check
- **Scope**: All production and development dependencies
- **Auto-fix**: Low-severity vulnerabilities with available patches
- **Reporting**: Security dashboard updated after each scan

## Vulnerability Response SLAs

| Severity | Response Time | Resolution Time | Escalation |
|----------|---------------|-----------------|------------|
| Critical | 2 hours | 24 hours | Immediate Telegram alert + blocking deployment |
| High | 4 hours | 72 hours | Telegram notification + MR review required |
| Medium | 24 hours | 1 week | Standard MR process |
| Low | 48 hours | 1 month | Batch fixes monthly |

## Secret Scanning Rules

### Prohibited Patterns
- API keys: `[a-zA-Z0-9_-]{20,}`
- Firebase keys: `AIza[0-9A-Za-z_-]{35}`
- Plaid secrets: `[a-f0-9]{64}`
- Anthropic API keys: `sk-ant-[a-zA-Z0-9_-]{95,}`
- Database URLs with credentials
- Private keys (RSA, SSH, etc.)
- JWT secrets and tokens

### Allowed Exceptions
- Example keys in documentation (marked with `# EXAMPLE - NOT REAL`)
- Test environment keys (must be in `.env.test` or similar)
- Public keys and certificates

## Code Review Requirements

### All Merge Requests Must Have:
- Security scan pass (SAST + SCA + secrets)
- LLM security review (auto-generated)
- Manual review for HIGH/CRITICAL findings
- Test coverage maintained or improved

### Security-Critical Changes Require:
- Two reviewer approvals
- Security team review
- Staging deployment test
- Production deployment plan

## Penetration Testing

- **Schedule**: Quarterly (January, April, July, October)
- **Scope**: All production applications and APIs
- **Method**: Automated + manual testing
- **Documentation**: Findings logged in security dashboard
- **Follow-up**: All findings must be remediated or risk-accepted within 30 days

## Data Handling Rules

### PII (Personally Identifiable Information)
- **Encryption at rest**: AES-256 minimum
- **Encryption in transit**: TLS 1.2+ required
- **Access controls**: Role-based, principle of least privilege
- **Audit logging**: All PII access logged with user, timestamp, purpose
- **Data retention**: Automatic deletion per user privacy settings

### Sensitive Data Categories
1. **Authentication data**: Passwords, tokens, biometrics
2. **Financial data**: Banking info, transaction history, budgets
3. **Health data**: Fitness metrics, nutrition data, health goals
4. **Personal data**: Email, phone, location, preferences

### Data Processing Rules
- No sensitive data in logs
- Masked data in development environments
- Secure data transfer between services
- Regular data classification reviews

## API Security

### Authentication & Authorization
- All endpoints require authentication (except public health checks)
- JWT tokens with 24-hour expiration
- Refresh token rotation
- Multi-factor authentication for admin endpoints

### Rate Limiting
- **Default**: 100 requests/minute per user
- **Auth endpoints**: 5 requests/minute per IP
- **File upload**: 10 requests/hour per user
- **LLM endpoints**: 20 requests/minute per user

### Input Validation
- Strict schema validation on all inputs
- SQL injection prevention via parameterized queries
- XSS prevention via output encoding
- File upload restrictions (type, size, virus scanning)

### Response Security
- No sensitive data in error messages
- Consistent error formats
- Security headers (CORS, CSP, HSTS)
- Request/response logging for audit

## Incident Response

### Classification
- **P1 (Critical)**: Data breach, system compromise, complete service outage
- **P2 (High)**: Partial service outage, significant vulnerability
- **P3 (Medium)**: Minor vulnerability, service degradation
- **P4 (Low)**: Security recommendations, minor issues

### Response Team
- **Primary**: Sam (Platform Owner)
- **Backup**: System automatically creates incident tickets
- **Escalation**: External security consultant if needed

### Communication Plan
- **P1/P2**: Immediate Telegram alerts + status page updates
- **P3/P4**: Daily security reports + weekly summaries
- **All incidents**: Post-mortem documentation required

## Compliance & Auditing

### Regular Audits
- Monthly: Automated security scan summary
- Quarterly: Manual code review of security-critical components
- Annually: Third-party security assessment

### Documentation Requirements
- Security architecture diagrams
- Threat modeling for new features
- Security test plans
- Incident response runbooks

### Monitoring & Alerting
- Failed authentication attempts
- Unusual API usage patterns
- Database access anomalies
- File system changes in production

## Implementation Status

- [ ] SAST scanning configured
- [ ] SCA scanning configured
- [ ] Secret scanning configured
- [ ] LLM security review pipeline
- [ ] Autonomous remediation system
- [ ] Security middleware deployed
- [ ] Firestore rules audited
- [ ] Monitoring and alerting configured

## Guardrails Architecture (`@claw/guardrails`)

All Claw apps MUST integrate the `@claw/guardrails` package before shipping to production.

### Components

| Module | Purpose |
|--------|---------|
| `rate-limiter.ts` | Per-user, per-endpoint sliding window rate limiting with presets (AI_COACH: 10/min, QUERY: 30/min, STANDARD: 60/min) |
| `llm-guard.ts` | Prompt injection detection & sanitization, safe system prompt wrapping, output validation |
| `output-guard.ts` | Domain-specific output validation (fitness, nutrition, finance, meetings), dangerous content blocking, auto-disclaimer injection |
| `disclaimers.ts` | Centralized disclaimer constants (short + full versions, i18n-ready) |

### How It Works

1. **User input** → `sanitizeUserInput()` strips injection patterns, flags suspicious input
2. **System prompt** → `createSafeSystemPrompt()` wraps with injection-resistant framing
3. **LLM output** → `validateLLMOutput()` checks for system prompt leaks, PII, blocked patterns
4. **Domain output** → `createOutputGuard(domain)` validates domain-specific safety rules, appends disclaimers

### LLM Router Integration

The `@claw/llm-router` auto-applies guardrails:
- Every user message is sanitized via `sanitizeUserInput()` before being sent to any LLM
- Every LLM response is validated via `validateLLMOutput()` for system prompt leaks
- Rate limiting hooks are available per-user via middleware presets

### App-Level Compliance Requirements

Each app **MUST**:

1. **Rate limit all AI endpoints** using `@claw/guardrails` presets or custom configs
2. **Use `createSafeSystemPrompt()`** for all system prompts sent to LLMs
3. **Apply `createOutputGuard(domain)`** to all AI coach responses before returning to users
4. **Never hardcode system prompts** in client-side code
5. **Never return raw LLM responses** without output validation
6. **Log all flagged injection attempts** for security review

### App-Level Security Review Checklist

- [ ] All AI endpoints rate-limited with appropriate preset
- [ ] System prompts wrapped with `createSafeSystemPrompt()`
- [ ] Output guard configured for app domain (fitness/nutrition/finance/meetings)
- [ ] Disclaimers displayed on onboarding AND in AI responses
- [ ] No system prompt content exposed to clients
- [ ] Injection attempt logging enabled
- [ ] PII validation enabled for user-facing outputs
- [ ] Dangerous content patterns tested for the app's domain
- [ ] Rate limit headers returned to clients
- [ ] 429 responses handled gracefully in client UI

---

**Last Updated**: 2026-02-17
**Next Review**: 2026-05-16
**Owner**: Sam
**Approvers**: Security Team