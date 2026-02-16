#!/usr/bin/env node

/**
 * LLM-Powered Log Analysis for Security Anomaly Detection
 * 
 * Analyzes Firebase Function logs and other application logs to detect:
 * - Unusual error patterns
 * - Authentication failures
 * - Rate limit violations
 * - Suspicious payloads
 * - Security-relevant events
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import Anthropic from '@anthropic-ai/sdk';

interface LogEntry {
  timestamp: string;
  level: 'error' | 'warn' | 'info' | 'debug';
  message: string;
  source: string;
  userId?: string;
  ip?: string;
  userAgent?: string;
  endpoint?: string;
  statusCode?: number;
  duration?: number;
  metadata?: Record<string, any>;
}

interface SecurityAnomaly {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: 'authentication' | 'authorization' | 'injection' | 'dos' | 'data_exposure' | 'suspicious_behavior';
  title: string;
  description: string;
  evidence: LogEntry[];
  confidence: 'high' | 'medium' | 'low';
  recommendation: string;
  affectedUsers?: string[];
  timeRange: { start: string; end: string };
  count: number;
  pattern?: string;
  riskAssessment?: string;
}

interface AnalysisOptions {
  logFiles?: string[];
  timeRange?: { start: Date; end: Date };
  sources?: string[];
  outputFile?: string;
  format?: 'json' | 'markdown' | 'alert';
  createIssues?: boolean;
  realtime?: boolean;
  skipLLMAnalysis?: boolean;
}

class LogAnalyzer {
  private anthropic?: Anthropic;
  private securityPatterns = {
    // Authentication patterns
    authFailure: /(?:authentication|auth|login|signin).*(?:fail|error|invalid|denied)/i,
    bruteForce: /(?:too many|rate limit|attempts exceeded|blocked)/i,
    accountLockout: /(?:account|user).*(?:lock|suspend|disable)/i,
    
    // Injection patterns
    sqlInjection: /(?:select|union|insert|update|delete|drop).*(?:from|into|where|table)/i,
    xssAttempt: /<script|javascript:|data:text\/html|eval\(|alert\(/i,
    commandInjection: /(?:exec|system|cmd|bash|sh|powershell|\/bin\/).*[;&|`]/i,
    
    // Suspicious patterns
    pathTraversal: /\.\.\/|\.\.\\|%2e%2e|%5c|%2f/i,
    sensitiveFiles: /\/etc\/passwd|\/etc\/shadow|web\.config|\.env|config\.php/i,
    scanning: /(?:nmap|nikto|sqlmap|dirb|gobuster|ffuf)/i,
    
    // Error patterns
    serverError: /5\d{2}|internal server error|exception|stack trace/i,
    databaseError: /database|connection|query|syntax error/i,
    permissionError: /permission|access denied|unauthorized|forbidden/i
  };

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      this.anthropic = new Anthropic({ apiKey });
    } else {
      console.warn('ANTHROPIC_API_KEY not set - LLM analysis will be limited');
    }
  }

  async analyzeLogFiles(filePaths: string[], options: AnalysisOptions = {}): Promise<SecurityAnomaly[]> {
    console.log(`Analyzing ${filePaths.length} log files...`);
    
    const allLogs: LogEntry[] = [];
    
    // Parse all log files
    for (const filePath of filePaths) {
      if (fs.existsSync(filePath)) {
        const logs = await this.parseLogFile(filePath);
        allLogs.push(...logs);
      } else {
        console.warn(`Log file not found: ${filePath}`);
      }
    }

    // Filter by time range if specified
    let filteredLogs = allLogs;
    if (options.timeRange) {
      filteredLogs = allLogs.filter(log => {
        const logTime = new Date(log.timestamp);
        return logTime >= options.timeRange!.start && logTime <= options.timeRange!.end;
      });
    }

    console.log(`Processing ${filteredLogs.length} log entries...`);
    
    // Detect anomalies using pattern matching
    const patternAnomalies = this.detectPatternAnomalies(filteredLogs);
    
    // Detect statistical anomalies
    const statisticalAnomalies = this.detectStatisticalAnomalies(filteredLogs);
    
    // Combine all anomalies
    let allAnomalies = [...patternAnomalies, ...statisticalAnomalies];
    
    // Enhance with LLM analysis
    if (!options.skipLLMAnalysis && this.anthropic) {
      allAnomalies = await this.enhanceWithLLMAnalysis(allAnomalies, filteredLogs);
    }

    // Sort by severity and confidence
    allAnomalies.sort((a, b) => {
      const severityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
      const confidenceOrder = { high: 3, medium: 2, low: 1 };
      
      return (severityOrder[b.severity] * 10 + confidenceOrder[b.confidence]) - 
             (severityOrder[a.severity] * 10 + confidenceOrder[a.confidence]);
    });

    return allAnomalies;
  }

  private async parseLogFile(filePath: string): Promise<LogEntry[]> {
    const logs: LogEntry[] = [];
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter(line => line.trim());

    for (const line of lines) {
      const entry = this.parseLogLine(line, path.basename(filePath));
      if (entry) {
        logs.push(entry);
      }
    }

    return logs;
  }

  private parseLogLine(line: string, source: string): LogEntry | null {
    try {
      // Try parsing as JSON first (Firebase Functions format)
      if (line.startsWith('{')) {
        const json = JSON.parse(line);
        return {
          timestamp: json.timestamp || json.time || new Date().toISOString(),
          level: json.severity?.toLowerCase() || json.level || 'info',
          message: json.message || json.msg || line,
          source,
          userId: json.userId || json.user_id,
          ip: json.ip || json.remoteAddress || json.client_ip,
          userAgent: json.userAgent || json['user-agent'],
          endpoint: json.endpoint || json.path || json.url,
          statusCode: json.statusCode || json.status,
          duration: json.duration || json.responseTime,
          metadata: json
        };
      }

      // Parse common log formats
      // Apache/Nginx combined log format
      const combinedLogRegex = /^(\S+) \S+ \S+ \[([\w:\/]+\s[+\-]\d{4})\] "(.+?)" (\d{3}) (\d+) "([^"]*)" "([^"]*)"/;
      const combinedMatch = line.match(combinedLogRegex);
      
      if (combinedMatch) {
        return {
          timestamp: new Date(combinedMatch[2]).toISOString(),
          level: parseInt(combinedMatch[4]) >= 400 ? 'error' : 'info',
          message: combinedMatch[3],
          source,
          ip: combinedMatch[1],
          statusCode: parseInt(combinedMatch[4]),
          userAgent: combinedMatch[7],
          metadata: {
            method: combinedMatch[3].split(' ')[0],
            path: combinedMatch[3].split(' ')[1],
            size: combinedMatch[5],
            referer: combinedMatch[6]
          }
        };
      }

      // Timestamp + Level + Message format
      const timestampRegex = /^(\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:?\d{2})?)\s+(\w+)\s+(.+)$/;
      const timestampMatch = line.match(timestampRegex);
      
      if (timestampMatch) {
        return {
          timestamp: new Date(timestampMatch[1]).toISOString(),
          level: timestampMatch[2].toLowerCase() as any || 'info',
          message: timestampMatch[3],
          source
        };
      }

      // Fallback: treat as plain message with current timestamp
      return {
        timestamp: new Date().toISOString(),
        level: 'info',
        message: line,
        source
      };

    } catch (error) {
      console.warn(`Failed to parse log line: ${line.slice(0, 100)}...`);
      return null;
    }
  }

  private detectPatternAnomalies(logs: LogEntry[]): SecurityAnomaly[] {
    const anomalies: SecurityAnomaly[] = [];

    // Group logs by pattern matches
    const patternMatches: Record<string, LogEntry[]> = {};

    for (const log of logs) {
      for (const [patternName, pattern] of Object.entries(this.securityPatterns)) {
        if (pattern.test(log.message)) {
          if (!patternMatches[patternName]) {
            patternMatches[patternName] = [];
          }
          patternMatches[patternName].push(log);
        }
      }
    }

    // Create anomalies for significant patterns
    for (const [patternName, matches] of Object.entries(patternMatches)) {
      if (matches.length === 0) continue;

      const anomaly = this.createPatternAnomaly(patternName, matches);
      if (anomaly) {
        anomalies.push(anomaly);
      }
    }

    return anomalies;
  }

  private createPatternAnomaly(patternName: string, matches: LogEntry[]): SecurityAnomaly | null {
    if (matches.length === 0) return null;

    const timeRange = {
      start: matches[0].timestamp,
      end: matches[matches.length - 1].timestamp
    };

    const affectedUsers = [...new Set(matches.map(m => m.userId).filter(Boolean))];
    const uniqueIPs = [...new Set(matches.map(m => m.ip).filter(Boolean))];

    // Determine severity based on pattern and count
    let severity: 'critical' | 'high' | 'medium' | 'low' = 'medium';
    let category: SecurityAnomaly['category'] = 'suspicious_behavior';
    let confidence: 'high' | 'medium' | 'low' = 'medium';

    const patternConfig = {
      authFailure: {
        severity: matches.length > 20 ? 'high' : 'medium',
        category: 'authentication' as const,
        confidence: 'high' as const,
        title: 'Authentication Failures Detected',
        description: `${matches.length} authentication failures detected`
      },
      bruteForce: {
        severity: 'high',
        category: 'authentication' as const,
        confidence: 'high' as const,
        title: 'Brute Force Attack Detected',
        description: `Brute force attack patterns detected from ${uniqueIPs.length} IP addresses`
      },
      sqlInjection: {
        severity: 'critical',
        category: 'injection' as const,
        confidence: 'high' as const,
        title: 'SQL Injection Attempts',
        description: `${matches.length} potential SQL injection attempts detected`
      },
      xssAttempt: {
        severity: 'high',
        category: 'injection' as const,
        confidence: 'high' as const,
        title: 'XSS Attack Attempts',
        description: `${matches.length} potential XSS attack attempts detected`
      },
      commandInjection: {
        severity: 'critical',
        category: 'injection' as const,
        confidence: 'high' as const,
        title: 'Command Injection Attempts',
        description: `${matches.length} potential command injection attempts detected`
      },
      pathTraversal: {
        severity: 'high',
        category: 'data_exposure' as const,
        confidence: 'medium' as const,
        title: 'Path Traversal Attempts',
        description: `${matches.length} path traversal attempts detected`
      },
      scanning: {
        severity: 'medium',
        category: 'suspicious_behavior' as const,
        confidence: 'high' as const,
        title: 'Security Scanning Detected',
        description: `Security scanning tools detected in ${matches.length} requests`
      }
    };

    const config = patternConfig[patternName as keyof typeof patternConfig];
    if (!config) return null;

    return {
      id: `pattern-${patternName}-${Date.now()}`,
      severity: config.severity,
      category: config.category,
      title: config.title,
      description: config.description,
      evidence: matches.slice(0, 10), // Limit evidence to first 10 entries
      confidence: config.confidence,
      recommendation: this.getRecommendation(config.category, config.severity),
      affectedUsers: affectedUsers.slice(0, 20), // Limit to 20 users
      timeRange,
      count: matches.length,
      pattern: patternName
    };
  }

  private detectStatisticalAnomalies(logs: LogEntry[]): SecurityAnomaly[] {
    const anomalies: SecurityAnomaly[] = [];

    // Analyze error rates over time
    const errorRateAnomaly = this.detectErrorRateSpike(logs);
    if (errorRateAnomaly) anomalies.push(errorRateAnomaly);

    // Analyze authentication patterns
    const authAnomaly = this.detectAuthenticationAnomalies(logs);
    if (authAnomaly) anomalies.push(authAnomaly);

    // Analyze request patterns
    const requestAnomaly = this.detectUnusualRequestPatterns(logs);
    if (requestAnomaly) anomalies.push(requestAnomaly);

    return anomalies;
  }

  private detectErrorRateSpike(logs: LogEntry[]): SecurityAnomaly | null {
    const hourlyErrors: Record<string, number> = {};
    const hourlyTotal: Record<string, number> = {};

    for (const log of logs) {
      const hour = log.timestamp.slice(0, 13); // YYYY-MM-DDTHH
      
      if (!hourlyTotal[hour]) {
        hourlyTotal[hour] = 0;
        hourlyErrors[hour] = 0;
      }
      
      hourlyTotal[hour]++;
      if (log.level === 'error' || (log.statusCode && log.statusCode >= 500)) {
        hourlyErrors[hour]++;
      }
    }

    // Calculate error rates
    const errorRates = Object.keys(hourlyTotal).map(hour => ({
      hour,
      rate: hourlyErrors[hour] / hourlyTotal[hour],
      errors: hourlyErrors[hour],
      total: hourlyTotal[hour]
    }));

    if (errorRates.length < 2) return null;

    // Find unusual spikes (rate > 3x average)
    const averageRate = errorRates.reduce((sum, r) => sum + r.rate, 0) / errorRates.length;
    const spikes = errorRates.filter(r => r.rate > averageRate * 3 && r.errors > 10);

    if (spikes.length === 0) return null;

    const spikeHours = spikes.map(s => s.hour);
    const evidenceLogs = logs.filter(log => 
      spikeHours.some(hour => log.timestamp.startsWith(hour)) &&
      (log.level === 'error' || (log.statusCode && log.statusCode >= 500))
    ).slice(0, 10);

    return {
      id: `error-spike-${Date.now()}`,
      severity: spikes.length > 3 ? 'high' : 'medium',
      category: 'suspicious_behavior',
      title: 'Error Rate Spike Detected',
      description: `Error rate spiked to ${Math.max(...spikes.map(s => s.rate * 100)).toFixed(1)}% in ${spikes.length} time periods`,
      evidence: evidenceLogs,
      confidence: 'medium',
      recommendation: 'Investigate the cause of increased error rates. Check for system issues, attacks, or configuration problems.',
      timeRange: {
        start: spikeHours[0] + ':00:00.000Z',
        end: spikeHours[spikeHours.length - 1] + ':59:59.999Z'
      },
      count: spikes.reduce((sum, s) => sum + s.errors, 0)
    };
  }

  private detectAuthenticationAnomalies(logs: LogEntry[]): SecurityAnomaly | null {
    const authLogs = logs.filter(log => 
      log.message.toLowerCase().includes('auth') ||
      log.message.toLowerCase().includes('login') ||
      log.endpoint?.includes('auth')
    );

    if (authLogs.length < 10) return null;

    // Group by IP address
    const ipCounts: Record<string, { total: number; failed: number; users: Set<string> }> = {};

    for (const log of authLogs) {
      const ip = log.ip;
      if (!ip) continue;

      if (!ipCounts[ip]) {
        ipCounts[ip] = { total: 0, failed: 0, users: new Set() };
      }

      ipCounts[ip].total++;
      if (log.userId) ipCounts[ip].users.add(log.userId);
      
      if (log.level === 'error' || 
          log.statusCode === 401 || 
          log.message.toLowerCase().includes('fail')) {
        ipCounts[ip].failed++;
      }
    }

    // Find suspicious IPs (high failure rate or targeting multiple users)
    const suspiciousIPs = Object.entries(ipCounts).filter(([ip, data]) => {
      const failureRate = data.failed / data.total;
      return (failureRate > 0.5 && data.total > 5) || data.users.size > 10;
    });

    if (suspiciousIPs.length === 0) return null;

    const evidenceLogs = authLogs.filter(log => 
      suspiciousIPs.some(([ip]) => log.ip === ip)
    ).slice(0, 15);

    return {
      id: `auth-anomaly-${Date.now()}`,
      severity: suspiciousIPs.length > 5 ? 'high' : 'medium',
      category: 'authentication',
      title: 'Authentication Anomaly Detected',
      description: `${suspiciousIPs.length} IP addresses showing suspicious authentication patterns`,
      evidence: evidenceLogs,
      confidence: 'medium',
      recommendation: 'Review authentication patterns. Consider implementing IP-based rate limiting or blocking suspicious IPs.',
      timeRange: {
        start: authLogs[0].timestamp,
        end: authLogs[authLogs.length - 1].timestamp
      },
      count: suspiciousIPs.reduce((sum, [, data]) => sum + data.total, 0)
    };
  }

  private detectUnusualRequestPatterns(logs: LogEntry[]): SecurityAnomaly | null {
    const requestLogs = logs.filter(log => log.endpoint);
    if (requestLogs.length < 50) return null;

    // Analyze endpoint access patterns
    const endpointCounts: Record<string, number> = {};
    for (const log of requestLogs) {
      endpointCounts[log.endpoint!] = (endpointCounts[log.endpoint!] || 0) + 1;
    }

    // Find endpoints with unusual access patterns (very high or very low compared to average)
    const counts = Object.values(endpointCounts);
    const average = counts.reduce((sum, count) => sum + count, 0) / counts.length;
    const stdDev = Math.sqrt(counts.reduce((sum, count) => sum + Math.pow(count - average, 2), 0) / counts.length);

    const unusualEndpoints = Object.entries(endpointCounts).filter(([endpoint, count]) => {
      return Math.abs(count - average) > 2 * stdDev && count > 20;
    });

    if (unusualEndpoints.length === 0) return null;

    const evidenceLogs = requestLogs.filter(log => 
      unusualEndpoints.some(([endpoint]) => log.endpoint === endpoint)
    ).slice(0, 10);

    return {
      id: `request-pattern-${Date.now()}`,
      severity: 'low',
      category: 'suspicious_behavior',
      title: 'Unusual Request Patterns',
      description: `${unusualEndpoints.length} endpoints showing unusual access patterns`,
      evidence: evidenceLogs,
      confidence: 'low',
      recommendation: 'Review access patterns to these endpoints. Consider if increased traffic is expected or suspicious.',
      timeRange: {
        start: requestLogs[0].timestamp,
        end: requestLogs[requestLogs.length - 1].timestamp
      },
      count: unusualEndpoints.reduce((sum, [, count]) => sum + count, 0)
    };
  }

  private async enhanceWithLLMAnalysis(
    anomalies: SecurityAnomaly[], 
    allLogs: LogEntry[]
  ): Promise<SecurityAnomaly[]> {
    if (!this.anthropic || anomalies.length === 0) {
      return anomalies;
    }

    console.log(`Enhancing ${anomalies.length} anomalies with LLM analysis...`);

    const enhanced = [...anomalies];

    // Analyze high-priority anomalies with LLM
    const highPriorityAnomalies = anomalies.filter(a => 
      a.severity === 'critical' || a.severity === 'high'
    );

    for (const anomaly of highPriorityAnomalies) {
      try {
        const analysis = await this.analyzeSingleAnomaly(anomaly, allLogs);
        const enhanced_anomaly = enhanced.find(a => a.id === anomaly.id);
        if (enhanced_anomaly) {
          enhanced_anomaly.riskAssessment = analysis.riskAssessment;
          enhanced_anomaly.recommendation = analysis.enhancedRecommendation || enhanced_anomaly.recommendation;
          enhanced_anomaly.confidence = analysis.confidence || enhanced_anomaly.confidence;
        }
      } catch (error) {
        console.error(`Failed to analyze anomaly ${anomaly.id}:`, error);
      }
    }

    return enhanced;
  }

  private async analyzeSingleAnomaly(
    anomaly: SecurityAnomaly, 
    contextLogs: LogEntry[]
  ): Promise<{
    riskAssessment: string;
    enhancedRecommendation?: string;
    confidence?: 'high' | 'medium' | 'low';
  }> {
    const contextWindow = contextLogs
      .filter(log => {
        const logTime = new Date(log.timestamp);
        const anomalyStart = new Date(anomaly.timeRange.start);
        const anomalyEnd = new Date(anomaly.timeRange.end);
        return logTime >= anomalyStart && logTime <= anomalyEnd;
      })
      .slice(0, 20)
      .map(log => `${log.timestamp} [${log.level}] ${log.message}`)
      .join('\n');

    const evidenceText = anomaly.evidence.slice(0, 5)
      .map(log => `${log.timestamp} [${log.level}] ${log.message}`)
      .join('\n');

    const prompt = `
Analyze this security anomaly for a Claw application (fitness/nutrition/meetings/budget platform):

ANOMALY DETAILS:
- Type: ${anomaly.title}
- Severity: ${anomaly.severity}
- Category: ${anomaly.category}
- Count: ${anomaly.count}
- Time Range: ${anomaly.timeRange.start} to ${anomaly.timeRange.end}
- Description: ${anomaly.description}

KEY EVIDENCE:
${evidenceText}

CONTEXT LOGS:
${contextWindow}

APPLICATION CONTEXT:
- Handles sensitive user data (health, financial, personal)
- Uses Firebase for backend services
- Serves web and mobile clients
- Processes user authentication and API requests

Please provide:
1. Risk assessment (impact if this is a real attack)
2. Confidence level (high/medium/low) that this indicates malicious activity
3. Enhanced recommendations specific to our application

Focus on practical, actionable insights. Consider false positive likelihood.`;

    const message = await this.anthropic!.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: prompt
      }]
    });

    const content = message.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response format from Claude');
    }

    const response = content.text;
    
    // Extract structured information from the response
    const riskMatch = response.match(/Risk assessment:?\s*([^]*?)(?=Confidence|Enhanced|$)/i);
    const confidenceMatch = response.match(/Confidence:?\s*(high|medium|low)/i);
    const recommendationMatch = response.match(/Enhanced recommendations?:?\s*([^]*?)$/i);

    return {
      riskAssessment: riskMatch ? riskMatch[1].trim() : response,
      confidence: confidenceMatch ? confidenceMatch[1].toLowerCase() as any : undefined,
      enhancedRecommendation: recommendationMatch ? recommendationMatch[1].trim() : undefined
    };
  }

  private getRecommendation(category: SecurityAnomaly['category'], severity: string): string {
    const recommendations = {
      authentication: 'Implement stronger authentication controls, rate limiting, and account lockout policies.',
      authorization: 'Review access controls and implement proper authorization checks.',
      injection: 'Implement input validation, parameterized queries, and output encoding.',
      dos: 'Implement rate limiting and DDoS protection measures.',
      data_exposure: 'Review data access patterns and implement proper access controls.',
      suspicious_behavior: 'Monitor closely and implement additional logging and alerting.'
    };

    const severityPrefix = severity === 'critical' ? 'URGENT: ' : severity === 'high' ? 'Priority: ' : '';
    return severityPrefix + recommendations[category];
  }

  generateMarkdownReport(anomalies: SecurityAnomaly[]): string {
    if (anomalies.length === 0) {
      return '# Security Log Analysis Report\n\n✅ No security anomalies detected in log analysis.\n';
    }

    const critical = anomalies.filter(a => a.severity === 'critical');
    const high = anomalies.filter(a => a.severity === 'high');
    const medium = anomalies.filter(a => a.severity === 'medium');
    const low = anomalies.filter(a => a.severity === 'low');

    let report = '# Security Log Analysis Report\n\n';
    report += `🔍 **Security anomaly detection completed**\n\n`;
    
    report += `## Summary\n\n`;
    report += `- 🔴 Critical: ${critical.length}\n`;
    report += `- 🟠 High: ${high.length}\n`;
    report += `- 🟡 Medium: ${medium.length}\n`;
    report += `- 🔵 Low: ${low.length}\n\n`;

    if (critical.length > 0) {
      report += '🚨 **IMMEDIATE ACTION REQUIRED**: Critical security anomalies detected.\n\n';
    }

    const sections = [
      { title: '🔴 Critical Anomalies', findings: critical },
      { title: '🟠 High-Priority Anomalies', findings: high },
      { title: '🟡 Medium-Priority Anomalies', findings: medium },
      { title: '🔵 Low-Priority Anomalies', findings: low }
    ];

    for (const section of sections) {
      if (section.findings.length > 0) {
        report += `## ${section.title}\n\n`;
        
        for (const anomaly of section.findings) {
          report += `### ${anomaly.title}\n\n`;
          report += `- **Category**: ${anomaly.category}\n`;
          report += `- **Severity**: ${anomaly.severity.toUpperCase()}\n`;
          report += `- **Confidence**: ${anomaly.confidence.toUpperCase()}\n`;
          report += `- **Count**: ${anomaly.count} occurrences\n`;
          report += `- **Time Range**: ${anomaly.timeRange.start} to ${anomaly.timeRange.end}\n`;
          
          if (anomaly.affectedUsers && anomaly.affectedUsers.length > 0) {
            report += `- **Affected Users**: ${anomaly.affectedUsers.length} (${anomaly.affectedUsers.slice(0, 5).join(', ')}${anomaly.affectedUsers.length > 5 ? '...' : ''})\n`;
          }
          
          report += `\n**Description**: ${anomaly.description}\n\n`;
          
          if (anomaly.riskAssessment) {
            report += `**Risk Assessment**: ${anomaly.riskAssessment}\n\n`;
          }
          
          report += `**Recommendation**: ${anomaly.recommendation}\n\n`;
          
          if (anomaly.evidence.length > 0) {
            report += `**Sample Evidence**:\n`;
            report += '```\n';
            anomaly.evidence.slice(0, 3).forEach(log => {
              report += `${log.timestamp} [${log.level}] ${log.message}\n`;
            });
            if (anomaly.evidence.length > 3) {
              report += `... and ${anomaly.evidence.length - 3} more entries\n`;
            }
            report += '```\n\n';
          }
          
          report += '---\n\n';
        }
      }
    }

    report += `## Action Plan\n\n`;
    
    if (critical.length > 0) {
      report += `🚨 **CRITICAL (Immediate Action Required)**:\n`;
      critical.forEach(a => {
        report += `- [ ] **${a.title}**: ${a.recommendation}\n`;
      });
      report += '\n';
    }
    
    if (high.length > 0) {
      report += `⚠️ **HIGH PRIORITY (Within 24 hours)**:\n`;
      high.forEach(a => {
        report += `- [ ] **${a.title}**: ${a.recommendation}\n`;
      });
      report += '\n';
    }
    
    if (medium.length > 0) {
      report += `📋 **MEDIUM PRIORITY (This week)**:\n`;
      medium.forEach(a => {
        report += `- [ ] **${a.title}**: ${a.recommendation}\n`;
      });
      report += '\n';
    }

    report += `## Detection Summary\n\n`;
    report += `- **Analysis Period**: ${anomalies[0]?.timeRange.start || 'N/A'} to ${anomalies[anomalies.length - 1]?.timeRange.end || 'N/A'}\n`;
    report += `- **Total Events Analyzed**: ${anomalies.reduce((sum, a) => sum + a.count, 0)}\n`;
    report += `- **Anomalies Detected**: ${anomalies.length}\n`;
    report += `- **LLM Enhanced**: ${anomalies.filter(a => a.riskAssessment).length}\n\n`;

    report += `## Next Steps\n\n`;
    report += `1. **Immediate**: Address all critical and high-priority anomalies\n`;
    report += `2. **Short-term**: Implement monitoring and alerting for detected patterns\n`;
    report += `3. **Long-term**: Enhance security controls based on findings\n`;
    report += `4. **Continuous**: Schedule regular log analysis and monitoring\n`;

    return report;
  }

  async createSecurityIssues(anomalies: SecurityAnomaly[], projectPath: string): Promise<void> {
    const criticalAndHigh = anomalies.filter(a => a.severity === 'critical' || a.severity === 'high');
    
    if (criticalAndHigh.length === 0) {
      console.log('No critical or high-severity anomalies to create issues for');
      return;
    }

    const issuesDir = path.join(projectPath, 'security-issues');
    if (!fs.existsSync(issuesDir)) {
      fs.mkdirSync(issuesDir, { recursive: true });
    }

    for (const anomaly of criticalAndHigh) {
      const issueContent = `# Security Issue: ${anomaly.title}

**Severity**: ${anomaly.severity.toUpperCase()}
**Category**: ${anomaly.category}
**Confidence**: ${anomaly.confidence.toUpperCase()}
**Detected**: ${new Date().toISOString()}

## Description
${anomaly.description}

## Impact Assessment
${anomaly.riskAssessment || 'Pending detailed analysis'}

## Evidence
- **Count**: ${anomaly.count} occurrences
- **Time Range**: ${anomaly.timeRange.start} to ${anomaly.timeRange.end}
- **Affected Users**: ${anomaly.affectedUsers?.length || 0}

## Sample Log Entries
\`\`\`
${anomaly.evidence.slice(0, 3).map(log => 
  `${log.timestamp} [${log.level}] ${log.message}`
).join('\n')}
\`\`\`

## Recommended Actions
${anomaly.recommendation}

## Assignee
- [ ] Assign to security team lead
- [ ] Set priority based on severity
- [ ] Track resolution progress

## Resolution Checklist
- [ ] Investigate root cause
- [ ] Implement fix/mitigation
- [ ] Verify resolution
- [ ] Update monitoring rules
- [ ] Document lessons learned

---
*Auto-generated by security log analyzer*
`;

      const filename = `${anomaly.severity}-${anomaly.category}-${Date.now()}.md`;
      const filepath = path.join(issuesDir, filename);
      
      fs.writeFileSync(filepath, issueContent);
      console.log(`Created security issue: ${filepath}`);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const options: AnalysisOptions = {};

  // Parse command line arguments
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.replace('--', '');
    const value = args[i + 1];
    
    switch (key) {
      case 'logs':
        options.logFiles = value ? value.split(',') : [];
        break;
      case 'output':
        options.outputFile = value;
        break;
      case 'format':
        options.format = value as 'json' | 'markdown' | 'alert';
        break;
      case 'create-issues':
        options.createIssues = value === 'true';
        break;
      case 'skip-llm':
        options.skipLLMAnalysis = value === 'true';
        break;
      case 'start-time':
        if (!options.timeRange) options.timeRange = {} as any;
        options.timeRange.start = new Date(value);
        break;
      case 'end-time':
        if (!options.timeRange) options.timeRange = {} as any;
        options.timeRange.end = new Date(value);
        break;
    }
  }

  // Default to looking for common log files if none specified
  if (!options.logFiles || options.logFiles.length === 0) {
    const commonLogPaths = [
      'logs/app.log',
      'logs/error.log',
      'logs/access.log',
      '/var/log/firebase/functions.log',
      'firebase-debug.log'
    ].filter(path => fs.existsSync(path));
    
    options.logFiles = commonLogPaths;
  }

  if (!options.logFiles || options.logFiles.length === 0) {
    console.error('No log files found. Specify log files with --logs path1,path2,path3');
    process.exit(1);
  }

  const analyzer = new LogAnalyzer();

  try {
    console.log('Starting security log analysis...');
    const anomalies = await analyzer.analyzeLogFiles(options.logFiles, options);
    
    console.log(`Analysis complete. Found ${anomalies.length} anomalies.`);

    // Create security issues if requested
    if (options.createIssues && anomalies.length > 0) {
      await analyzer.createSecurityIssues(anomalies, process.cwd());
    }

    // Generate output
    const format = options.format || 'markdown';
    let output: string;

    switch (format) {
      case 'json':
        output = JSON.stringify(anomalies, null, 2);
        break;
      case 'alert':
        const critical = anomalies.filter(a => a.severity === 'critical');
        const high = anomalies.filter(a => a.severity === 'high');
        output = `SECURITY ALERT: ${critical.length} critical, ${high.length} high severity anomalies detected`;
        break;
      default:
        output = analyzer.generateMarkdownReport(anomalies);
    }

    if (options.outputFile) {
      fs.writeFileSync(options.outputFile, output);
      console.log(`Report written to ${options.outputFile}`);
    } else {
      console.log(output);
    }

    // Exit with appropriate code based on findings
    const criticalOrHigh = anomalies.filter(a => a.severity === 'critical' || a.severity === 'high');
    if (criticalOrHigh.length > 0) {
      console.error(`\n❌ ${criticalOrHigh.length} critical/high severity anomalies detected`);
      process.exit(1);
    } else {
      console.log('\n✅ Security log analysis completed');
      process.exit(0);
    }

  } catch (error) {
    console.error('Security log analysis failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(console.error);
}

export { LogAnalyzer, SecurityAnomaly, AnalysisOptions };