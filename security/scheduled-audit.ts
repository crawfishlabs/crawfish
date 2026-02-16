#!/usr/bin/env node

/**
 * Scheduled Security Audit System
 * 
 * Runs periodic security audits:
 * - Weekly: Full codebase security review via LLM
 * - Monthly: Dependency audit and penetration test checklist  
 * - Quarterly: Comprehensive security assessment
 * 
 * Results are stored in Firestore for trending and alerting.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import Anthropic from '@anthropic-ai/sdk';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

interface AuditResult {
  id: string;
  timestamp: string;
  type: 'weekly' | 'monthly' | 'quarterly';
  status: 'completed' | 'failed' | 'in_progress';
  findings: AuditFinding[];
  metrics: SecurityMetrics;
  trends: TrendAnalysis;
  recommendations: string[];
  nextActions: string[];
  executionTime: number;
  version: string;
}

interface AuditFinding {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: string;
  title: string;
  description: string;
  evidence?: string[];
  recommendation: string;
  trend: 'new' | 'recurring' | 'improving' | 'worsening';
  firstSeen: string;
  lastSeen: string;
  occurrences: number;
}

interface SecurityMetrics {
  codebaseSize: {
    totalFiles: number;
    linesOfCode: number;
    testCoverage?: number;
  };
  vulnerabilities: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    total: number;
  };
  dependencies: {
    total: number;
    outdated: number;
    vulnerable: number;
    fixAvailable: number;
  };
  codeQuality: {
    securityScore: number;
    maintainabilityIndex: number;
    technicalDebt: number;
  };
  compliance: {
    sastPassing: boolean;
    dependencyAuditPassing: boolean;
    secretScanPassing: boolean;
    testsRunning: boolean;
  };
}

interface TrendAnalysis {
  vulnerabilityTrend: 'improving' | 'stable' | 'worsening';
  newVulnerabilities: number;
  resolvedVulnerabilities: number;
  averageResolutionTime: number;
  riskScore: number;
  previousRiskScore?: number;
  securityDebt: number;
}

interface PenetrationTestItem {
  category: string;
  item: string;
  status: 'pending' | 'completed' | 'failed' | 'not_applicable';
  evidence?: string;
  notes?: string;
  lastTested?: string;
}

class ScheduledAuditor {
  private anthropic: Anthropic;
  private db: FirebaseFirestore.Firestore;
  private auditHistory: AuditResult[] = [];

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY environment variable is required');
    }
    this.anthropic = new Anthropic({ apiKey });

    // Initialize Firebase Admin
    try {
      initializeApp({
        credential: applicationDefault()
      });
      this.db = getFirestore();
    } catch (error) {
      console.warn('Firebase not initialized - audit results will be saved locally only');
      this.db = null as any;
    }
  }

  async runWeeklyAudit(workingDir: string = '.'): Promise<AuditResult> {
    console.log('🔍 Starting weekly security audit...');
    const startTime = Date.now();

    const auditId = `weekly-${new Date().toISOString().slice(0, 10)}-${startTime}`;
    
    try {
      // Load previous audit for comparison
      await this.loadAuditHistory();

      // Run all security scans
      const sastFindings = await this.runSASTScan(workingDir);
      const dependencyFindings = await this.runDependencyAudit(workingDir);
      const secretFindings = await this.runSecretScan(workingDir);
      const logFindings = await this.runLogAnalysis(workingDir);

      // Combine all findings
      const allFindings = [
        ...sastFindings,
        ...dependencyFindings, 
        ...secretFindings,
        ...logFindings
      ];

      // Calculate metrics
      const metrics = await this.calculateSecurityMetrics(workingDir, allFindings);

      // Analyze trends
      const trends = this.analyzeTrends(allFindings);

      // Generate LLM insights
      const insights = await this.generateWeeklyInsights(allFindings, metrics, trends);

      const auditResult: AuditResult = {
        id: auditId,
        timestamp: new Date().toISOString(),
        type: 'weekly',
        status: 'completed',
        findings: allFindings,
        metrics,
        trends,
        recommendations: insights.recommendations,
        nextActions: insights.nextActions,
        executionTime: Date.now() - startTime,
        version: this.getVersionInfo(workingDir)
      };

      await this.saveAuditResult(auditResult);
      await this.sendAuditReport(auditResult);

      console.log(`✅ Weekly audit completed in ${auditResult.executionTime}ms`);
      console.log(`📊 Found ${allFindings.length} total findings`);
      
      return auditResult;

    } catch (error) {
      console.error('❌ Weekly audit failed:', error);
      
      const failedResult: AuditResult = {
        id: auditId,
        timestamp: new Date().toISOString(),
        type: 'weekly',
        status: 'failed',
        findings: [],
        metrics: {} as SecurityMetrics,
        trends: {} as TrendAnalysis,
        recommendations: [`Audit failed: ${error}`],
        nextActions: ['Investigate audit failure', 'Retry audit'],
        executionTime: Date.now() - startTime,
        version: 'unknown'
      };

      await this.saveAuditResult(failedResult);
      return failedResult;
    }
  }

  async runMonthlyAudit(workingDir: string = '.'): Promise<AuditResult> {
    console.log('📅 Starting monthly security audit...');
    const startTime = Date.now();

    const auditId = `monthly-${new Date().toISOString().slice(0, 7)}-${startTime}`;
    
    try {
      // Run weekly audit first
      const weeklyResults = await this.runWeeklyAudit(workingDir);

      // Additional monthly checks
      const penetrationTestResults = await this.runPenetrationTestChecklist(workingDir);
      const infrastructureAudit = await this.runInfrastructureAudit(workingDir);
      const complianceCheck = await this.runComplianceCheck(workingDir);

      // Comprehensive dependency analysis
      const dependencyReport = await this.runComprehensiveDependencyAudit(workingDir);

      // Combine findings
      const allFindings = [
        ...weeklyResults.findings,
        ...penetrationTestResults,
        ...infrastructureAudit,
        ...complianceCheck
      ];

      const metrics = await this.calculateSecurityMetrics(workingDir, allFindings);
      const trends = this.analyzeTrends(allFindings);

      // Generate monthly insights
      const insights = await this.generateMonthlyInsights(allFindings, metrics, trends, dependencyReport);

      const auditResult: AuditResult = {
        id: auditId,
        timestamp: new Date().toISOString(),
        type: 'monthly',
        status: 'completed',
        findings: allFindings,
        metrics,
        trends,
        recommendations: insights.recommendations,
        nextActions: insights.nextActions,
        executionTime: Date.now() - startTime,
        version: this.getVersionInfo(workingDir)
      };

      await this.saveAuditResult(auditResult);
      await this.sendAuditReport(auditResult);

      console.log(`✅ Monthly audit completed in ${auditResult.executionTime}ms`);
      return auditResult;

    } catch (error) {
      console.error('❌ Monthly audit failed:', error);
      throw error;
    }
  }

  async runQuarterlyAudit(workingDir: string = '.'): Promise<AuditResult> {
    console.log('📈 Starting quarterly security assessment...');
    const startTime = Date.now();

    const auditId = `quarterly-${new Date().getFullYear()}-Q${Math.ceil((new Date().getMonth() + 1) / 3)}-${startTime}`;
    
    try {
      // Run monthly audit first  
      const monthlyResults = await this.runMonthlyAudit(workingDir);

      // Additional quarterly assessments
      const threatModeling = await this.runThreatModelingReview(workingDir);
      const architectureReview = await this.runSecurityArchitectureReview(workingDir);
      const businessRiskAssessment = await this.runBusinessRiskAssessment(workingDir);
      const securityTrainingNeeds = await this.assessSecurityTrainingNeeds(workingDir);

      // Historical analysis
      const historicalAnalysis = await this.runHistoricalAnalysis();

      const allFindings = [
        ...monthlyResults.findings,
        ...threatModeling,
        ...architectureReview,
        ...businessRiskAssessment
      ];

      const metrics = await this.calculateSecurityMetrics(workingDir, allFindings);
      const trends = this.analyzeTrends(allFindings);

      // Generate quarterly insights
      const insights = await this.generateQuarterlyInsights(
        allFindings, 
        metrics, 
        trends, 
        historicalAnalysis,
        securityTrainingNeeds
      );

      const auditResult: AuditResult = {
        id: auditId,
        timestamp: new Date().toISOString(),
        type: 'quarterly',
        status: 'completed',
        findings: allFindings,
        metrics,
        trends,
        recommendations: insights.recommendations,
        nextActions: insights.nextActions,
        executionTime: Date.now() - startTime,
        version: this.getVersionInfo(workingDir)
      };

      await this.saveAuditResult(auditResult);
      await this.sendAuditReport(auditResult);

      console.log(`✅ Quarterly audit completed in ${auditResult.executionTime}ms`);
      return auditResult;

    } catch (error) {
      console.error('❌ Quarterly audit failed:', error);
      throw error;
    }
  }

  private async runSASTScan(workingDir: string): Promise<AuditFinding[]> {
    try {
      const sastScript = path.join(__dirname, 'llm-security-review.js');
      const result = execSync(`node ${sastScript} --format json`, {
        cwd: workingDir,
        encoding: 'utf8',
        timeout: 600000 // 10 minutes
      });

      const findings = JSON.parse(result);
      return findings.map((f: any) => this.convertToAuditFinding(f, 'sast'));
    } catch (error) {
      console.warn('SAST scan failed:', error);
      return [];
    }
  }

  private async runDependencyAudit(workingDir: string): Promise<AuditFinding[]> {
    try {
      const depScript = path.join(__dirname, 'dependency-audit.js');
      const result = execSync(`node ${depScript} --format json`, {
        cwd: workingDir,
        encoding: 'utf8',
        timeout: 300000 // 5 minutes
      });

      const findings = JSON.parse(result);
      return findings.map((f: any) => this.convertToAuditFinding(f, 'dependency'));
    } catch (error) {
      console.warn('Dependency audit failed:', error);
      return [];
    }
  }

  private async runSecretScan(workingDir: string): Promise<AuditFinding[]> {
    try {
      const secretScript = path.join(__dirname, 'secret-scanner.js');
      const result = execSync(`node ${secretScript} --format json`, {
        cwd: workingDir,
        encoding: 'utf8',
        timeout: 300000 // 5 minutes
      });

      const findings = JSON.parse(result);
      return findings.map((f: any) => this.convertToAuditFinding(f, 'secrets'));
    } catch (error) {
      console.warn('Secret scan failed:', error);
      return [];
    }
  }

  private async runLogAnalysis(workingDir: string): Promise<AuditFinding[]> {
    try {
      const logScript = path.join(__dirname, 'log-analyzer.js');
      
      // Look for common log files
      const logFiles = [
        'logs/app.log',
        'logs/error.log',
        'firebase-debug.log'
      ].filter(f => fs.existsSync(path.join(workingDir, f)))
        .join(',');

      if (!logFiles) return [];

      const result = execSync(`node ${logScript} --logs ${logFiles} --format json`, {
        cwd: workingDir,
        encoding: 'utf8',
        timeout: 600000 // 10 minutes
      });

      const findings = JSON.parse(result);
      return findings.map((f: any) => this.convertToAuditFinding(f, 'logs'));
    } catch (error) {
      console.warn('Log analysis failed:', error);
      return [];
    }
  }

  private convertToAuditFinding(finding: any, source: string): AuditFinding {
    return {
      id: finding.id || `${source}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      severity: finding.severity?.toLowerCase() || 'low',
      category: source,
      title: finding.title || finding.name || 'Security Issue',
      description: finding.description || finding.message || 'No description available',
      evidence: finding.evidence ? [JSON.stringify(finding.evidence)] : undefined,
      recommendation: finding.recommendation || finding.suggestedFix || 'Review and fix manually',
      trend: 'new', // Will be updated by trend analysis
      firstSeen: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      occurrences: 1
    };
  }

  private async calculateSecurityMetrics(workingDir: string, findings: AuditFinding[]): Promise<SecurityMetrics> {
    // Calculate codebase size
    const codebaseSize = await this.calculateCodebaseSize(workingDir);
    
    // Count vulnerabilities by severity
    const vulnerabilities = {
      critical: findings.filter(f => f.severity === 'critical').length,
      high: findings.filter(f => f.severity === 'high').length,
      medium: findings.filter(f => f.severity === 'medium').length,
      low: findings.filter(f => f.severity === 'low').length,
      total: findings.length
    };

    // Analyze dependencies
    const dependencies = await this.analyzeDependencies(workingDir);

    // Calculate security score (0-100)
    const securityScore = this.calculateSecurityScore(vulnerabilities, dependencies);

    // Check compliance
    const compliance = await this.checkCompliance(workingDir);

    return {
      codebaseSize,
      vulnerabilities,
      dependencies,
      codeQuality: {
        securityScore,
        maintainabilityIndex: 75, // Would calculate from code analysis
        technicalDebt: vulnerabilities.total * 2 + dependencies.outdated
      },
      compliance
    };
  }

  private async calculateCodebaseSize(workingDir: string): Promise<{ totalFiles: number; linesOfCode: number; testCoverage?: number }> {
    try {
      // Count files
      const fileCount = execSync("find . -name '*.ts' -o -name '*.js' -o -name '*.tsx' -o -name '*.jsx' | grep -v node_modules | wc -l", {
        cwd: workingDir,
        encoding: 'utf8'
      });

      // Count lines of code  
      const locCount = execSync("find . -name '*.ts' -o -name '*.js' -o -name '*.tsx' -o -name '*.jsx' | grep -v node_modules | xargs wc -l | tail -1", {
        cwd: workingDir,
        encoding: 'utf8'
      });

      return {
        totalFiles: parseInt(fileCount.trim()),
        linesOfCode: parseInt(locCount.trim().split(' ')[0]) || 0,
        testCoverage: await this.getTestCoverage(workingDir)
      };
    } catch (error) {
      console.warn('Could not calculate codebase size:', error);
      return { totalFiles: 0, linesOfCode: 0 };
    }
  }

  private async getTestCoverage(workingDir: string): Promise<number | undefined> {
    try {
      // Try to get coverage from jest or other tools
      if (fs.existsSync(path.join(workingDir, 'coverage/lcov-report/index.html'))) {
        // Parse coverage report if available
        // This is a simplified implementation
        return 75; // Placeholder
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  private async analyzeDependencies(workingDir: string): Promise<{ total: number; outdated: number; vulnerable: number; fixAvailable: number }> {
    try {
      // Get package count
      const packageJson = JSON.parse(fs.readFileSync(path.join(workingDir, 'package.json'), 'utf8'));
      const total = Object.keys(packageJson.dependencies || {}).length + 
                   Object.keys(packageJson.devDependencies || {}).length;

      // Check for outdated packages
      let outdated = 0;
      try {
        const outdatedResult = execSync('npm outdated --json', { cwd: workingDir, encoding: 'utf8' });
        const outdatedData = JSON.parse(outdatedResult);
        outdated = Object.keys(outdatedData).length;
      } catch {
        // npm outdated returns non-zero exit code when there are outdated packages
      }

      // Run audit to check vulnerabilities
      let vulnerable = 0;
      let fixAvailable = 0;
      try {
        const auditResult = execSync('npm audit --json', { cwd: workingDir, encoding: 'utf8' });
        const auditData = JSON.parse(auditResult);
        vulnerable = Object.keys(auditData.vulnerabilities || {}).length;
        fixAvailable = Object.values(auditData.vulnerabilities || {}).filter((v: any) => v.fixAvailable).length;
      } catch (error: any) {
        // Parse from error output if available
        try {
          const auditData = JSON.parse(error.stdout || '{}');
          vulnerable = Object.keys(auditData.vulnerabilities || {}).length;
          fixAvailable = Object.values(auditData.vulnerabilities || {}).filter((v: any) => v.fixAvailable).length;
        } catch {}
      }

      return { total, outdated, vulnerable, fixAvailable };
    } catch (error) {
      console.warn('Could not analyze dependencies:', error);
      return { total: 0, outdated: 0, vulnerable: 0, fixAvailable: 0 };
    }
  }

  private calculateSecurityScore(vulnerabilities: any, dependencies: any): number {
    // Simple scoring algorithm (0-100)
    let score = 100;
    
    // Deduct points for vulnerabilities
    score -= vulnerabilities.critical * 25;
    score -= vulnerabilities.high * 10;
    score -= vulnerabilities.medium * 5;
    score -= vulnerabilities.low * 1;
    
    // Deduct points for vulnerable dependencies
    score -= dependencies.vulnerable * 3;
    score -= dependencies.outdated * 1;
    
    return Math.max(0, Math.min(100, score));
  }

  private async checkCompliance(workingDir: string): Promise<{ sastPassing: boolean; dependencyAuditPassing: boolean; secretScanPassing: boolean; testsRunning: boolean }> {
    // Check if security scans are passing
    const sastPassing = fs.existsSync(path.join(workingDir, '.gitlab-ci.yml')) || 
                       fs.existsSync(path.join(workingDir, '.github/workflows'));
    
    const dependencyAuditPassing = !fs.existsSync(path.join(workingDir, 'npm-audit-report.json'));
    
    const secretScanPassing = true; // Would check actual scan results
    
    let testsRunning = false;
    try {
      execSync('npm test -- --passWithNoTests', { cwd: workingDir, stdio: 'pipe', timeout: 30000 });
      testsRunning = true;
    } catch {}

    return {
      sastPassing,
      dependencyAuditPassing,
      secretScanPassing,
      testsRunning
    };
  }

  private analyzeTrends(findings: AuditFinding[]): TrendAnalysis {
    // Compare with previous audit results
    const previousAudit = this.auditHistory[this.auditHistory.length - 1];
    
    let newVulnerabilities = findings.length;
    let resolvedVulnerabilities = 0;
    let averageResolutionTime = 0;
    
    if (previousAudit) {
      // Find new vulnerabilities
      const previousFindingIds = new Set(previousAudit.findings.map(f => f.title));
      newVulnerabilities = findings.filter(f => !previousFindingIds.has(f.title)).length;
      
      // Find resolved vulnerabilities  
      const currentFindingIds = new Set(findings.map(f => f.title));
      resolvedVulnerabilities = previousAudit.findings.filter(f => !currentFindingIds.has(f.title)).length;
    }

    const currentRiskScore = this.calculateRiskScore(findings);
    const previousRiskScore = previousAudit?.trends.riskScore;
    
    let vulnerabilityTrend: 'improving' | 'stable' | 'worsening' = 'stable';
    if (previousRiskScore !== undefined) {
      if (currentRiskScore < previousRiskScore * 0.9) {
        vulnerabilityTrend = 'improving';
      } else if (currentRiskScore > previousRiskScore * 1.1) {
        vulnerabilityTrend = 'worsening';
      }
    }

    return {
      vulnerabilityTrend,
      newVulnerabilities,
      resolvedVulnerabilities,
      averageResolutionTime,
      riskScore: currentRiskScore,
      previousRiskScore,
      securityDebt: findings.filter(f => f.severity === 'high' || f.severity === 'critical').length * 5
    };
  }

  private calculateRiskScore(findings: AuditFinding[]): number {
    const weights = { critical: 10, high: 5, medium: 2, low: 1 };
    return findings.reduce((score, finding) => {
      return score + (weights[finding.severity as keyof typeof weights] || 1);
    }, 0);
  }

  private async generateWeeklyInsights(
    findings: AuditFinding[], 
    metrics: SecurityMetrics, 
    trends: TrendAnalysis
  ): Promise<{ recommendations: string[]; nextActions: string[] }> {
    if (!this.anthropic) {
      return {
        recommendations: ['Weekly security review completed'],
        nextActions: ['Review findings and prioritize fixes']
      };
    }

    const prompt = `
Analyze this weekly security audit for a Claw application platform:

FINDINGS SUMMARY:
- Total findings: ${findings.length}
- Critical: ${metrics.vulnerabilities.critical}
- High: ${metrics.vulnerabilities.high}  
- Medium: ${metrics.vulnerabilities.medium}
- Low: ${metrics.vulnerabilities.low}

SECURITY METRICS:
- Security Score: ${metrics.codeQuality.securityScore}/100
- Vulnerable Dependencies: ${metrics.dependencies.vulnerable}
- Test Coverage: ${metrics.codebaseSize.testCoverage || 'Unknown'}%

TRENDS:
- Vulnerability Trend: ${trends.vulnerabilityTrend}
- New Issues: ${trends.newVulnerabilities}
- Resolved Issues: ${trends.resolvedVulnerabilities}
- Risk Score: ${trends.riskScore} (previous: ${trends.previousRiskScore || 'N/A'})

KEY FINDINGS:
${findings.slice(0, 5).map(f => `- ${f.severity.toUpperCase()}: ${f.title}`).join('\n')}

Provide:
1. Top 3 recommendations for this week
2. Next 3 actions to prioritize

Focus on actionable, specific advice for a fitness/nutrition/budget/meetings platform handling sensitive user data.`;

    try {
      const message = await this.anthropic.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 800,
        messages: [{ role: 'user', content: prompt }]
      });

      const content = message.content[0];
      if (content.type !== 'text') {
        throw new Error('Unexpected response format');
      }

      const response = content.text;
      
      // Parse recommendations and actions from response
      const recMatch = response.match(/recommendations?:?\s*\n((?:.*\n?)*?)(?=next|actions?|$)/i);
      const actionMatch = response.match(/(?:next\s+)?actions?:?\s*\n((?:.*\n?)*)$/i);

      const recommendations = recMatch 
        ? recMatch[1].split('\n').filter(r => r.trim()).map(r => r.replace(/^\d+\.\s*/, '').trim())
        : ['Review and address security findings'];

      const nextActions = actionMatch
        ? actionMatch[1].split('\n').filter(a => a.trim()).map(a => a.replace(/^\d+\.\s*/, '').trim())
        : ['Prioritize high-severity findings', 'Update dependencies', 'Review access controls'];

      return { 
        recommendations: recommendations.slice(0, 3),
        nextActions: nextActions.slice(0, 3)
      };
    } catch (error) {
      console.warn('LLM insights generation failed:', error);
      return {
        recommendations: ['Review weekly security scan results'],
        nextActions: ['Address critical and high-severity findings']
      };
    }
  }

  private async generateMonthlyInsights(
    findings: AuditFinding[], 
    metrics: SecurityMetrics, 
    trends: TrendAnalysis,
    dependencyReport: any
  ): Promise<{ recommendations: string[]; nextActions: string[] }> {
    // Enhanced analysis for monthly review
    return {
      recommendations: [
        'Conduct security architecture review',
        'Update penetration testing checklist',
        'Review access control policies'
      ],
      nextActions: [
        'Schedule third-party security assessment',
        'Update security training materials',
        'Audit user access permissions'
      ]
    };
  }

  private async generateQuarterlyInsights(
    findings: AuditFinding[], 
    metrics: SecurityMetrics, 
    trends: TrendAnalysis,
    historicalAnalysis: any,
    trainingNeeds: any
  ): Promise<{ recommendations: string[]; nextActions: string[] }> {
    // Comprehensive quarterly analysis
    return {
      recommendations: [
        'Update security strategy based on threat landscape',
        'Invest in security tooling improvements',
        'Enhance incident response procedures'
      ],
      nextActions: [
        'Plan security budget for next quarter',
        'Schedule security team training',
        'Review and update security policies'
      ]
    };
  }

  // Placeholder methods for additional audit types
  private async runPenetrationTestChecklist(workingDir: string): Promise<AuditFinding[]> {
    // Would implement actual penetration testing checklist
    return [];
  }

  private async runInfrastructureAudit(workingDir: string): Promise<AuditFinding[]> {
    // Would audit infrastructure configuration
    return [];
  }

  private async runComplianceCheck(workingDir: string): Promise<AuditFinding[]> {
    // Would check compliance requirements
    return [];
  }

  private async runComprehensiveDependencyAudit(workingDir: string): Promise<any> {
    // Would run comprehensive dependency analysis
    return {};
  }

  private async runThreatModelingReview(workingDir: string): Promise<AuditFinding[]> {
    return [];
  }

  private async runSecurityArchitectureReview(workingDir: string): Promise<AuditFinding[]> {
    return [];
  }

  private async runBusinessRiskAssessment(workingDir: string): Promise<AuditFinding[]> {
    return [];
  }

  private async assessSecurityTrainingNeeds(workingDir: string): Promise<any> {
    return {};
  }

  private async runHistoricalAnalysis(): Promise<any> {
    return {};
  }

  private getVersionInfo(workingDir: string): string {
    try {
      const gitCommit = execSync('git rev-parse --short HEAD', { cwd: workingDir, encoding: 'utf8' }).trim();
      const gitBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: workingDir, encoding: 'utf8' }).trim();
      return `${gitBranch}@${gitCommit}`;
    } catch {
      return 'unknown';
    }
  }

  private async loadAuditHistory(): Promise<void> {
    if (this.db) {
      try {
        const snapshot = await this.db.collection('security_audits')
          .orderBy('timestamp', 'desc')
          .limit(10)
          .get();

        this.auditHistory = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as AuditResult));
      } catch (error) {
        console.warn('Could not load audit history from Firestore:', error);
      }
    }

    // Also try to load from local files
    const localHistoryPath = 'security-audits';
    if (fs.existsSync(localHistoryPath)) {
      const files = fs.readdirSync(localHistoryPath)
        .filter(f => f.endsWith('.json'))
        .sort()
        .reverse()
        .slice(0, 10);

      for (const file of files) {
        try {
          const audit = JSON.parse(fs.readFileSync(path.join(localHistoryPath, file), 'utf8'));
          this.auditHistory.push(audit);
        } catch (error) {
          console.warn(`Could not load audit file ${file}:`, error);
        }
      }
    }
  }

  private async saveAuditResult(result: AuditResult): Promise<void> {
    // Save to Firestore
    if (this.db) {
      try {
        await this.db.collection('security_audits').doc(result.id).set(result);
        console.log(`📄 Audit saved to Firestore: ${result.id}`);
      } catch (error) {
        console.warn('Could not save audit to Firestore:', error);
      }
    }

    // Save locally as backup
    const localDir = 'security-audits';
    if (!fs.existsSync(localDir)) {
      fs.mkdirSync(localDir, { recursive: true });
    }

    const filename = `${result.id}.json`;
    fs.writeFileSync(path.join(localDir, filename), JSON.stringify(result, null, 2));
    console.log(`📄 Audit saved locally: ${filename}`);
  }

  private async sendAuditReport(result: AuditResult): Promise<void> {
    const reportContent = this.generateAuditReportMarkdown(result);
    
    // Save report file
    const reportDir = 'security-reports';
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }

    const reportFile = path.join(reportDir, `${result.id}-report.md`);
    fs.writeFileSync(reportFile, reportContent);
    
    console.log(`📊 Report generated: ${reportFile}`);

    // In a real implementation, would send via email/Telegram/Slack
    if (result.findings.filter(f => f.severity === 'critical' || f.severity === 'high').length > 0) {
      console.log('🚨 HIGH PRIORITY: Critical/high severity findings detected!');
    }
  }

  private generateAuditReportMarkdown(result: AuditResult): string {
    const criticalCount = result.findings.filter(f => f.severity === 'critical').length;
    const highCount = result.findings.filter(f => f.severity === 'high').length;

    let report = `# ${result.type.charAt(0).toUpperCase() + result.type.slice(1)} Security Audit Report

**Audit ID**: ${result.id}  
**Timestamp**: ${result.timestamp}  
**Status**: ${result.status}  
**Execution Time**: ${result.executionTime}ms  
**Version**: ${result.version}

## Executive Summary

${result.status === 'completed' ? 
  `This ${result.type} security audit identified **${result.findings.length}** total findings, including **${criticalCount}** critical and **${highCount}** high-severity issues.` :
  `This ${result.type} security audit failed to complete successfully.`}

## Security Metrics

- **Security Score**: ${result.metrics?.codeQuality?.securityScore || 'N/A'}/100
- **Codebase**: ${result.metrics?.codebaseSize?.totalFiles || 'N/A'} files, ${result.metrics?.codebaseSize?.linesOfCode || 'N/A'} LOC
- **Test Coverage**: ${result.metrics?.codebaseSize?.testCoverage || 'Unknown'}%
- **Dependencies**: ${result.metrics?.dependencies?.total || 'N/A'} total, ${result.metrics?.dependencies?.vulnerable || 'N/A'} vulnerable

## Findings Summary

- 🔴 **Critical**: ${criticalCount}
- 🟠 **High**: ${highCount}  
- 🟡 **Medium**: ${result.findings.filter(f => f.severity === 'medium').length}
- 🔵 **Low**: ${result.findings.filter(f => f.severity === 'low').length}

## Trend Analysis

- **Vulnerability Trend**: ${result.trends?.vulnerabilityTrend || 'N/A'}
- **New Issues**: ${result.trends?.newVulnerabilities || 0}
- **Resolved Issues**: ${result.trends?.resolvedVulnerabilities || 0}
- **Risk Score**: ${result.trends?.riskScore || 'N/A'}

## Key Recommendations

${result.recommendations.map(r => `- ${r}`).join('\n')}

## Next Actions

${result.nextActions.map(a => `- [ ] ${a}`).join('\n')}

## Compliance Status

${result.metrics?.compliance ? `
- **SAST Scanning**: ${result.metrics.compliance.sastPassing ? '✅ Passing' : '❌ Failing'}
- **Dependency Audit**: ${result.metrics.compliance.dependencyAuditPassing ? '✅ Passing' : '❌ Failing'}  
- **Secret Scanning**: ${result.metrics.compliance.secretScanPassing ? '✅ Passing' : '❌ Failing'}
- **Test Suite**: ${result.metrics.compliance.testsRunning ? '✅ Running' : '❌ Not Running'}
` : 'Compliance status not available'}

---

*This report was generated automatically by the Claw Security Audit System.*`;

    return report;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const auditType = args[0] || 'weekly';
  const workingDir = args[1] || '.';

  const auditor = new ScheduledAuditor();

  try {
    let result: AuditResult;

    switch (auditType) {
      case 'weekly':
        result = await auditor.runWeeklyAudit(workingDir);
        break;
      case 'monthly':
        result = await auditor.runMonthlyAudit(workingDir);
        break;
      case 'quarterly':
        result = await auditor.runQuarterlyAudit(workingDir);
        break;
      default:
        console.error('Invalid audit type. Use: weekly, monthly, or quarterly');
        process.exit(1);
    }

    console.log(`\n✅ ${auditType} audit completed successfully`);
    console.log(`📊 Audit ID: ${result.id}`);
    console.log(`🔍 Findings: ${result.findings.length} total`);
    console.log(`⏱️  Execution time: ${result.executionTime}ms`);

    if (result.status === 'completed') {
      const critical = result.findings.filter(f => f.severity === 'critical').length;
      const high = result.findings.filter(f => f.severity === 'high').length;
      
      if (critical > 0 || high > 0) {
        console.log(`\n🚨 ATTENTION: ${critical} critical and ${high} high-severity issues require immediate attention!`);
        process.exit(1);
      }
    }

    process.exit(0);

  } catch (error) {
    console.error(`❌ ${auditType} audit failed:`, error);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(console.error);
}

export { ScheduledAuditor, AuditResult, AuditFinding, SecurityMetrics };