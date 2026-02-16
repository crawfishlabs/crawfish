#!/usr/bin/env node

/**
 * Software Composition Analysis (SCA) Wrapper
 * 
 * This script runs npm audit, cross-references with CVE databases,
 * and provides LLM-powered analysis of complex vulnerabilities.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import Anthropic from '@anthropic-ai/sdk';

interface VulnerabilityFinding {
  id: string;
  name: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  overview: string;
  recommendation: string;
  references: string[];
  vulnerable_versions: string;
  patched_versions: string;
  module_name: string;
  finding_type: 'dependency_vulnerability';
  via?: string[];
  effects?: string[];
  range?: string;
  nodes?: string[];
  fixAvailable?: boolean | object;
  cveId?: string;
  cvssScore?: number;
  impactAssessment?: string;
  businessRisk?: 'critical' | 'high' | 'medium' | 'low';
  autoFixable?: boolean;
  suggestedFix?: string;
}

interface AuditOptions {
  input?: string;
  output?: string;
  format?: 'json' | 'markdown' | 'gitlab';
  createFix?: boolean;
  skipLLMAnalysis?: boolean;
  workingDir?: string;
}

class DependencyAuditor {
  private anthropic: Anthropic;
  private readonly cvePriorities = {
    'critical': { score: 9.0, urgency: 'immediate' },
    'high': { score: 7.0, urgency: 'urgent' },
    'medium': { score: 4.0, urgency: 'moderate' },
    'low': { score: 2.0, urgency: 'low' }
  };

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      this.anthropic = new Anthropic({ apiKey });
    } else {
      console.warn('ANTHROPIC_API_KEY not set - LLM analysis will be skipped');
    }
  }

  async runAudit(workingDir: string = '.'): Promise<VulnerabilityFinding[]> {
    console.log('Running npm audit...');
    
    try {
      // Run npm audit and capture both stdout and stderr
      const auditCommand = 'npm audit --json';
      const auditResult = execSync(auditCommand, { 
        cwd: workingDir, 
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024 // 10MB buffer
      });
      
      const auditData = JSON.parse(auditResult);
      return this.parseNpmAuditResults(auditData);
      
    } catch (error: any) {
      // npm audit returns non-zero exit code when vulnerabilities are found
      if (error.stdout) {
        try {
          const auditData = JSON.parse(error.stdout);
          return this.parseNpmAuditResults(auditData);
        } catch (parseError) {
          console.error('Failed to parse npm audit output:', parseError);
          return [];
        }
      }
      console.error('npm audit failed:', error.message);
      return [];
    }
  }

  private parseNpmAuditResults(auditData: any): VulnerabilityFinding[] {
    const findings: VulnerabilityFinding[] = [];
    
    if (!auditData.vulnerabilities) {
      console.log('No vulnerabilities found in npm audit');
      return findings;
    }

    for (const [packageName, vulnerability] of Object.entries(auditData.vulnerabilities as any)) {
      const vuln = vulnerability as any;
      
      const finding: VulnerabilityFinding = {
        id: `npm-${packageName}-${vuln.severity}`,
        name: packageName,
        severity: vuln.severity,
        title: vuln.title || `${packageName} vulnerability`,
        overview: vuln.overview || vuln.url || 'No description available',
        recommendation: vuln.recommendation || 'Update to patched version',
        references: vuln.references ? [vuln.references] : [vuln.url].filter(Boolean),
        vulnerable_versions: vuln.range || vuln.versions?.join(', ') || 'Unknown',
        patched_versions: 'See recommendation',
        module_name: packageName,
        finding_type: 'dependency_vulnerability',
        via: vuln.via || [],
        effects: vuln.effects || [],
        range: vuln.range,
        nodes: vuln.nodes || [],
        fixAvailable: vuln.fixAvailable,
        autoFixable: !!vuln.fixAvailable && typeof vuln.fixAvailable !== 'object'
      };

      // Extract CVE IDs if available
      if (vuln.cves && vuln.cves.length > 0) {
        finding.cveId = vuln.cves[0];
      }

      // Calculate business risk based on severity and usage
      finding.businessRisk = this.calculateBusinessRisk(finding);

      findings.push(finding);
    }

    return findings;
  }

  private calculateBusinessRisk(finding: VulnerabilityFinding): 'critical' | 'high' | 'medium' | 'low' {
    // Factor in severity, whether it's in production dependencies, and effects
    const isProduction = !finding.name.includes('@types') && 
                        !finding.name.includes('eslint') &&
                        !finding.name.includes('jest');
    
    const hasExternalEffects = finding.effects && finding.effects.length > 0;
    
    if (finding.severity === 'critical' && isProduction) return 'critical';
    if (finding.severity === 'high' && (isProduction || hasExternalEffects)) return 'high';
    if (finding.severity === 'medium' && isProduction) return 'medium';
    return 'low';
  }

  async enhanceWithLLMAnalysis(findings: VulnerabilityFinding[]): Promise<VulnerabilityFinding[]> {
    if (!this.anthropic) {
      console.log('Skipping LLM analysis - no API key configured');
      return findings;
    }

    console.log(`Analyzing ${findings.length} vulnerabilities with LLM...`);
    
    const enhancedFindings = [...findings];
    
    // Batch process high/critical findings for detailed analysis
    const highPriorityFindings = findings.filter(f => 
      f.severity === 'critical' || f.severity === 'high'
    );

    for (const finding of highPriorityFindings) {
      try {
        const analysis = await this.analyzeSingleVulnerability(finding);
        const enhanced = enhancedFindings.find(f => f.id === finding.id);
        if (enhanced) {
          enhanced.impactAssessment = analysis.impactAssessment;
          enhanced.suggestedFix = analysis.suggestedFix;
          enhanced.businessRisk = analysis.businessRisk || enhanced.businessRisk;
        }
      } catch (error) {
        console.error(`Failed to analyze ${finding.name}:`, error);
      }
    }

    return enhancedFindings;
  }

  private async analyzeSingleVulnerability(finding: VulnerabilityFinding): Promise<{
    impactAssessment: string;
    suggestedFix: string;
    businessRisk: 'critical' | 'high' | 'medium' | 'low';
  }> {
    const prompt = `
Analyze this security vulnerability for a Claw app (fitness/nutrition/meetings/budget platform):

Package: ${finding.name}
Severity: ${finding.severity}
Title: ${finding.title}
Overview: ${finding.overview}
Vulnerable Versions: ${finding.vulnerable_versions}
Fix Available: ${finding.fixAvailable}
CVE: ${finding.cveId || 'None'}

Context: This is a TypeScript/React/Firebase application handling user data including:
- Personal fitness and health data
- Financial information (budgets, transactions)
- Meeting recordings and transcripts
- User authentication and profiles

Provide:
1. Impact assessment (how this vulnerability affects our specific use case)
2. Business risk level (critical/high/medium/low)
3. Specific fix steps for our codebase

Be concise but thorough. Focus on actionable recommendations.`;

    const message = await this.anthropic.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 800,
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
    const impactMatch = response.match(/Impact assessment:?\s*([^]*?)(?=Business risk|Specific fix|$)/i);
    const riskMatch = response.match(/Business risk:?\s*(critical|high|medium|low)/i);
    const fixMatch = response.match(/Specific fix:?\s*([^]*?)$/i);

    return {
      impactAssessment: impactMatch ? impactMatch[1].trim() : response,
      businessRisk: (riskMatch ? riskMatch[1].toLowerCase() : finding.severity) as any,
      suggestedFix: fixMatch ? fixMatch[1].trim() : finding.recommendation
    };
  }

  async generateFixPR(findings: VulnerabilityFinding[], workingDir: string = '.'): Promise<string | null> {
    const autoFixableFindings = findings.filter(f => f.autoFixable);
    
    if (autoFixableFindings.length === 0) {
      console.log('No auto-fixable vulnerabilities found');
      return null;
    }

    console.log(`Attempting to auto-fix ${autoFixableFindings.length} vulnerabilities...`);

    try {
      // Create backup branch
      const currentBranch = execSync('git branch --show-current', { 
        cwd: workingDir, 
        encoding: 'utf8' 
      }).trim();
      
      const fixBranch = `security-deps-fix-${Date.now()}`;
      execSync(`git checkout -b ${fixBranch}`, { cwd: workingDir });

      // Run npm audit fix
      execSync('npm audit fix --force', { cwd: workingDir });

      // Verify fixes worked by running audit again
      const postFixAudit = await this.runAudit(workingDir);
      const remainingIssues = postFixAudit.filter(issue => 
        autoFixableFindings.some(original => original.name === issue.name)
      );

      const fixedCount = autoFixableFindings.length - remainingIssues.length;

      if (fixedCount > 0) {
        // Update package-lock.json and commit
        execSync('npm install', { cwd: workingDir });
        execSync('git add package*.json', { cwd: workingDir });
        
        const commitMessage = `security: fix ${fixedCount} dependency vulnerabilities

Auto-fixed vulnerabilities:
${autoFixableFindings.slice(0, 10).map(f => `- ${f.name}: ${f.title}`).join('\n')}
${autoFixableFindings.length > 10 ? `\n... and ${autoFixableFindings.length - 10} more` : ''}

- Ran npm audit fix
- Updated package-lock.json
- Requires review and testing before merge`;

        execSync(`git commit -m "${commitMessage}"`, { cwd: workingDir });
        execSync(`git push origin ${fixBranch}`, { cwd: workingDir });
        
        console.log(`✅ Created fix branch ${fixBranch} with ${fixedCount} fixes`);
        return fixBranch;
      } else {
        // No fixes applied, cleanup
        execSync(`git checkout ${currentBranch}`, { cwd: workingDir });
        execSync(`git branch -D ${fixBranch}`, { cwd: workingDir });
        console.log('❌ No vulnerabilities were successfully fixed');
        return null;
      }

    } catch (error) {
      console.error('Failed to generate fix PR:', error);
      return null;
    }
  }

  generateMarkdownReport(findings: VulnerabilityFinding[]): string {
    if (findings.length === 0) {
      return '# Dependency Security Report\n\n✅ No dependency vulnerabilities found.\n';
    }

    const critical = findings.filter(f => f.severity === 'critical');
    const high = findings.filter(f => f.severity === 'high');
    const medium = findings.filter(f => f.severity === 'medium');
    const low = findings.filter(f => f.severity === 'low');

    let report = '# Dependency Security Report\n\n';
    report += `## Summary\n\n`;
    report += `- 🔴 Critical: ${critical.length}\n`;
    report += `- 🟠 High: ${high.length}\n`;
    report += `- 🟡 Medium: ${medium.length}\n`;
    report += `- 🔵 Low: ${low.length}\n\n`;

    const autoFixable = findings.filter(f => f.autoFixable);
    if (autoFixable.length > 0) {
      report += `💡 **${autoFixable.length} vulnerabilities can be auto-fixed with \`npm audit fix\`**\n\n`;
    }

    const sections = [
      { title: '🔴 Critical Vulnerabilities', findings: critical },
      { title: '🟠 High Vulnerabilities', findings: high },
      { title: '🟡 Medium Vulnerabilities', findings: medium },
      { title: '🔵 Low Vulnerabilities', findings: low }
    ];

    for (const section of sections) {
      if (section.findings.length > 0) {
        report += `## ${section.title}\n\n`;
        
        for (const finding of section.findings) {
          report += `### ${finding.name}\n\n`;
          report += `- **Severity**: ${finding.severity.toUpperCase()}\n`;
          report += `- **Business Risk**: ${finding.businessRisk?.toUpperCase()}\n`;
          report += `- **Vulnerable Versions**: ${finding.vulnerable_versions}\n`;
          
          if (finding.cveId) {
            report += `- **CVE**: [${finding.cveId}](https://cve.mitre.org/cgi-bin/cvename.cgi?name=${finding.cveId})\n`;
          }
          
          report += `- **Auto-fixable**: ${finding.autoFixable ? '✅ Yes' : '❌ No'}\n`;
          report += `\n**Description**: ${finding.overview}\n\n`;
          
          if (finding.impactAssessment) {
            report += `**Impact Assessment**: ${finding.impactAssessment}\n\n`;
          }
          
          report += `**Recommendation**: ${finding.suggestedFix || finding.recommendation}\n\n`;
          
          if (finding.references && finding.references.length > 0) {
            report += `**References**:\n`;
            finding.references.forEach(ref => {
              report += `- ${ref}\n`;
            });
            report += '\n';
          }
          
          report += '---\n\n';
        }
      }
    }

    // Add action items
    report += `## Action Items\n\n`;
    
    if (critical.length > 0) {
      report += `🚨 **URGENT**: ${critical.length} critical vulnerabilities require immediate attention\n`;
    }
    
    if (autoFixable.length > 0) {
      report += `1. Run \`npm audit fix\` to auto-fix ${autoFixable.length} vulnerabilities\n`;
    }
    
    const manualFixes = findings.filter(f => !f.autoFixable);
    if (manualFixes.length > 0) {
      report += `2. Manually address ${manualFixes.length} vulnerabilities that cannot be auto-fixed\n`;
    }
    
    report += `3. Re-run security scan after applying fixes\n`;
    report += `4. Update dependency management policies if needed\n\n`;

    // Add timeline based on severity
    if (critical.length > 0 || high.length > 0) {
      report += `## Response Timeline\n\n`;
      if (critical.length > 0) report += `- **Critical**: Fix within 24 hours ⏰\n`;
      if (high.length > 0) report += `- **High**: Fix within 72 hours\n`;
      if (medium.length > 0) report += `- **Medium**: Fix within 1 week\n`;
      if (low.length > 0) report += `- **Low**: Fix within 1 month\n`;
    }

    return report;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const options: AuditOptions = {};

  // Parse command line arguments
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.replace('--', '');
    const value = args[i + 1];
    
    switch (key) {
      case 'input':
        options.input = value;
        break;
      case 'output':
        options.output = value;
        break;
      case 'format':
        options.format = value as 'json' | 'markdown' | 'gitlab';
        break;
      case 'create-fix':
        options.createFix = value === 'true';
        break;
      case 'skip-llm':
        options.skipLLMAnalysis = value === 'true';
        break;
      case 'working-dir':
        options.workingDir = value;
        break;
    }
  }

  const auditor = new DependencyAuditor();

  try {
    let findings: VulnerabilityFinding[];

    if (options.input) {
      // Parse existing npm audit results
      const auditData = JSON.parse(fs.readFileSync(options.input, 'utf8'));
      findings = auditor['parseNpmAuditResults'](auditData);
    } else {
      // Run fresh audit
      findings = await auditor.runAudit(options.workingDir);
    }

    console.log(`Found ${findings.length} dependency vulnerabilities`);

    // Enhance with LLM analysis unless skipped
    if (!options.skipLLMAnalysis && findings.length > 0) {
      findings = await auditor.enhanceWithLLMAnalysis(findings);
    }

    // Generate fix PR if requested
    if (options.createFix) {
      const fixBranch = await auditor.generateFixPR(findings, options.workingDir);
      if (fixBranch) {
        console.log(`Created fix branch: ${fixBranch}`);
      }
    }

    // Output results
    const format = options.format || 'markdown';
    let output: string;

    switch (format) {
      case 'json':
        output = JSON.stringify(findings, null, 2);
        break;
      case 'gitlab':
        output = JSON.stringify({
          vulnerabilities: findings.map(f => ({
            id: f.id,
            name: f.name,
            severity: f.severity.toUpperCase(),
            description: f.overview,
            solution: f.suggestedFix || f.recommendation,
            location: {
              file: 'package.json',
              dependency: {
                package: {
                  name: f.name
                },
                version: f.vulnerable_versions
              }
            },
            identifiers: [
              ...(f.cveId ? [{ type: 'cve', name: f.cveId, url: `https://cve.mitre.org/cgi-bin/cvename.cgi?name=${f.cveId}` }] : [])
            ],
            links: f.references.map(ref => ({ url: ref }))
          }))
        }, null, 2);
        break;
      default:
        output = auditor.generateMarkdownReport(findings);
    }

    if (options.output) {
      fs.writeFileSync(options.output, output);
      console.log(`Report written to ${options.output}`);
    } else {
      console.log(output);
    }

    // Exit with appropriate code based on findings
    const criticalOrHigh = findings.filter(f => f.severity === 'critical' || f.severity === 'high');
    if (criticalOrHigh.length > 0) {
      console.error(`\n❌ ${criticalOrHigh.length} critical/high severity dependency vulnerabilities found`);
      process.exit(1);
    } else {
      console.log('\n✅ Dependency audit passed');
      process.exit(0);
    }

  } catch (error) {
    console.error('Dependency audit failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(console.error);
}

export { DependencyAuditor, VulnerabilityFinding, AuditOptions };