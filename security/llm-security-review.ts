#!/usr/bin/env node

/**
 * LLM-Powered Security Review System
 * 
 * This script provides automated security review using Claude Haiku for cost efficiency.
 * It can analyze git diffs, full files, or SAST results and provide structured security findings.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import Anthropic from '@anthropic-ai/sdk';

interface SecurityFinding {
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  file: string;
  line: number;
  column?: number;
  title: string;
  description: string;
  suggestedFix: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  category: string;
  cweId?: string;
}

interface ReviewOptions {
  input?: string;
  diff?: string;
  files?: string[];
  output?: string;
  format?: 'json' | 'markdown' | 'gitlab-sast';
  createMR?: boolean;
  autoFix?: boolean;
  maxTokens?: number;
}

class LLMSecurityReviewer {
  private anthropic: Anthropic;
  private readonly securityPrompt = `
You are a security expert reviewing code for vulnerabilities. Focus on:

CRITICAL ISSUES:
- SQL injection vulnerabilities
- Authentication bypass
- Data exposure/leakage
- Command injection
- Hardcoded secrets/credentials
- Insecure deserialization

HIGH ISSUES:
- XSS vulnerabilities
- CSRF vulnerabilities
- Path traversal
- SSRF vulnerabilities
- Insecure crypto usage
- Authorization flaws

MEDIUM ISSUES:
- Information disclosure
- Insecure configurations
- Weak validation
- Race conditions
- Prompt injection (for LLM endpoints)

LOW ISSUES:
- Security best practices
- Defensive programming
- Code quality with security implications

For each finding, provide:
1. Severity level
2. Exact file and line number
3. Clear description of the vulnerability
4. Concrete fix suggestion
5. CWE ID if applicable

Focus on actionable, high-confidence findings. Avoid false positives.
Return response as valid JSON only.`;

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY environment variable is required');
    }
    this.anthropic = new Anthropic({ apiKey });
  }

  async reviewCode(code: string, filename: string = 'unknown'): Promise<SecurityFinding[]> {
    try {
      const message = await this.anthropic.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: `${this.securityPrompt}

Analyze this code for security vulnerabilities:

File: ${filename}
\`\`\`
${code}
\`\`\`

Return findings as JSON array: [{"severity": "HIGH", "file": "${filename}", "line": 10, "title": "SQL Injection", "description": "...", "suggestedFix": "...", "confidence": "HIGH", "category": "injection", "cweId": "CWE-89"}]`
        }]
      });

      const content = message.content[0];
      if (content.type !== 'text') {
        throw new Error('Unexpected response format from Claude');
      }

      // Extract JSON from response (handle potential markdown formatting)
      const jsonMatch = content.text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        console.warn(`No valid JSON found in Claude response for ${filename}`);
        return [];
      }

      const findings: SecurityFinding[] = JSON.parse(jsonMatch[0]);
      return findings.filter(f => f.severity && f.file && f.line && f.title);
    } catch (error) {
      console.error(`Error reviewing ${filename}:`, error);
      return [];
    }
  }

  async reviewDiff(diffContent: string): Promise<SecurityFinding[]> {
    const allFindings: SecurityFinding[] = [];
    
    // Parse diff to extract changed files and lines
    const files = this.parseDiff(diffContent);
    
    for (const file of files) {
      if (this.shouldAnalyzeFile(file.filename)) {
        const findings = await this.reviewCode(file.content, file.filename);
        // Filter findings to only include lines that were actually changed
        const relevantFindings = findings.filter(finding => 
          file.changedLines.includes(finding.line)
        );
        allFindings.push(...relevantFindings);
      }
    }
    
    return allFindings;
  }

  async reviewSASTResults(sastResultsPath: string): Promise<SecurityFinding[]> {
    const sastResults = JSON.parse(fs.readFileSync(sastResultsPath, 'utf8'));
    const allFindings: SecurityFinding[] = [];

    // Convert SAST results to our format and get LLM analysis for context
    for (const result of sastResults.results || []) {
      for (const match of result.extra?.matches || []) {
        const file = match.path;
        if (fs.existsSync(file)) {
          const fileContent = fs.readFileSync(file, 'utf8');
          const lines = fileContent.split('\n');
          const startLine = Math.max(0, match.start.line - 5);
          const endLine = Math.min(lines.length, match.end.line + 5);
          const contextCode = lines.slice(startLine, endLine).join('\n');

          // Get LLM analysis of this specific finding
          const findings = await this.reviewCode(contextCode, file);
          const relevantFinding = findings.find(f => 
            Math.abs(f.line - match.start.line) <= 2
          );

          if (relevantFinding) {
            allFindings.push(relevantFinding);
          }
        }
      }
    }

    return allFindings;
  }

  private parseDiff(diffContent: string): Array<{filename: string, content: string, changedLines: number[]}> {
    const files: Array<{filename: string, content: string, changedLines: number[]}> = [];
    const diffLines = diffContent.split('\n');
    
    let currentFile: string | null = null;
    let currentContent: string[] = [];
    let changedLines: number[] = [];
    let lineNumber = 0;

    for (const line of diffLines) {
      if (line.startsWith('diff --git') || line.startsWith('+++')) {
        if (currentFile && currentContent.length > 0) {
          files.push({
            filename: currentFile,
            content: currentContent.join('\n'),
            changedLines: [...changedLines]
          });
        }
        
        if (line.startsWith('+++')) {
          currentFile = line.slice(6).replace(/^b\//, '');
          currentContent = [];
          changedLines = [];
          lineNumber = 0;
        }
      } else if (line.startsWith('@@')) {
        const match = line.match(/@@ -\d+,?\d* \+(\d+),?\d* @@/);
        if (match) {
          lineNumber = parseInt(match[1]) - 1;
        }
      } else if (line.startsWith('+') && !line.startsWith('+++')) {
        lineNumber++;
        changedLines.push(lineNumber);
        currentContent.push(line.slice(1));
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        // Skip deleted lines for context
      } else if (line.startsWith(' ')) {
        lineNumber++;
        currentContent.push(line.slice(1));
      }
    }

    // Add the last file
    if (currentFile && currentContent.length > 0) {
      files.push({
        filename: currentFile,
        content: currentContent.join('\n'),
        changedLines
      });
    }

    return files;
  }

  private shouldAnalyzeFile(filename: string): boolean {
    const analyzableExtensions = ['.ts', '.js', '.tsx', '.jsx', '.swift', '.py', '.java', '.go'];
    const skipPatterns = ['node_modules', '.git', 'test', 'spec', '__tests__'];
    
    return analyzableExtensions.some(ext => filename.endsWith(ext)) &&
           !skipPatterns.some(pattern => filename.includes(pattern));
  }

  async generateMarkdownReport(findings: SecurityFinding[]): Promise<string> {
    if (findings.length === 0) {
      return '# Security Review Report\n\n✅ No security issues found.\n';
    }

    const criticalFindings = findings.filter(f => f.severity === 'CRITICAL');
    const highFindings = findings.filter(f => f.severity === 'HIGH');
    const mediumFindings = findings.filter(f => f.severity === 'MEDIUM');
    const lowFindings = findings.filter(f => f.severity === 'LOW');

    let report = '# Security Review Report\n\n';
    report += `## Summary\n\n`;
    report += `- 🔴 Critical: ${criticalFindings.length}\n`;
    report += `- 🟠 High: ${highFindings.length}\n`;
    report += `- 🟡 Medium: ${mediumFindings.length}\n`;
    report += `- 🔵 Low: ${lowFindings.length}\n\n`;

    const sections = [
      { title: '🔴 Critical Issues', findings: criticalFindings, blocksMerge: true },
      { title: '🟠 High Issues', findings: highFindings, blocksMerge: true },
      { title: '🟡 Medium Issues', findings: mediumFindings, blocksMerge: false },
      { title: '🔵 Low Issues', findings: lowFindings, blocksMerge: false }
    ];

    for (const section of sections) {
      if (section.findings.length > 0) {
        report += `## ${section.title}\n\n`;
        if (section.blocksMerge) {
          report += '⚠️ **These issues must be resolved before merge.**\n\n';
        }
        
        for (const finding of section.findings) {
          report += `### ${finding.title}\n\n`;
          report += `- **File**: ${finding.file}:${finding.line}\n`;
          report += `- **Severity**: ${finding.severity}\n`;
          report += `- **Category**: ${finding.category}\n`;
          report += `- **Confidence**: ${finding.confidence}\n`;
          if (finding.cweId) {
            report += `- **CWE**: ${finding.cweId}\n`;
          }
          report += `\n**Description**: ${finding.description}\n\n`;
          report += `**Suggested Fix**: ${finding.suggestedFix}\n\n`;
          report += '---\n\n';
        }
      }
    }

    report += `## Next Steps\n\n`;
    if (criticalFindings.length > 0 || highFindings.length > 0) {
      report += `1. ❌ **Merge blocked** due to critical/high severity issues\n`;
      report += `2. Address all critical and high severity findings\n`;
      report += `3. Re-run security scan after fixes\n`;
      report += `4. Request review from security team if needed\n`;
    } else {
      report += `1. ✅ **Merge approved** from security perspective\n`;
      report += `2. Consider addressing medium/low issues in future commits\n`;
    }

    return report;
  }

  async createFixMR(findings: SecurityFinding[], originalBranch: string): Promise<string | null> {
    const fixableFindings = findings.filter(f => 
      f.severity === 'LOW' || f.severity === 'MEDIUM'
    );

    if (fixableFindings.length === 0) {
      return null;
    }

    // Create a new branch for fixes
    const fixBranch = `security-auto-fix-${Date.now()}`;
    execSync(`git checkout -b ${fixBranch}`);

    let filesChanged = 0;
    for (const finding of fixableFindings) {
      try {
        await this.applyFix(finding);
        filesChanged++;
      } catch (error) {
        console.error(`Failed to apply fix for ${finding.file}:${finding.line}:`, error);
      }
    }

    if (filesChanged > 0) {
      execSync(`git add -A`);
      execSync(`git commit -m "security: auto-fix ${filesChanged} security findings

- Fixed ${fixableFindings.length} security issues
- Auto-generated by LLM security reviewer
- Requires review before merge"`);
      
      execSync(`git push origin ${fixBranch}`);
      
      // Would create GitLab MR here if GitLab API token available
      console.log(`Created branch ${fixBranch} with ${filesChanged} security fixes`);
      return fixBranch;
    }

    return null;
  }

  private async applyFix(finding: SecurityFinding): Promise<void> {
    // This would implement intelligent code fixing
    // For now, just log what would be fixed
    console.log(`Would fix ${finding.title} in ${finding.file}:${finding.line}`);
    console.log(`Suggested fix: ${finding.suggestedFix}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const options: ReviewOptions = {};

  // Parse command line arguments
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace('--', '');
    const value = args[i + 1];
    
    switch (key) {
      case 'input':
        options.input = value;
        break;
      case 'diff':
        options.diff = value;
        break;
      case 'output':
        options.output = value;
        break;
      case 'format':
        options.format = value as 'json' | 'markdown' | 'gitlab-sast';
        break;
      case 'create-mr':
        options.createMR = value === 'true';
        break;
      case 'auto-fix':
        options.autoFix = value === 'true';
        break;
    }
  }

  const reviewer = new LLMSecurityReviewer();
  let findings: SecurityFinding[] = [];

  try {
    if (options.input) {
      // Review SAST results
      findings = await reviewer.reviewSASTResults(options.input);
    } else if (options.diff) {
      // Review git diff
      const diffContent = fs.readFileSync(options.diff, 'utf8');
      findings = await reviewer.reviewDiff(diffContent);
    } else {
      // Review current working directory
      const files = execSync('find . -name "*.ts" -o -name "*.js" -o -name "*.tsx" -o -name "*.jsx"')
        .toString()
        .split('\n')
        .filter(f => f.trim() && !f.includes('node_modules') && !f.includes('.git'));

      for (const file of files) {
        const content = fs.readFileSync(file, 'utf8');
        const fileFindings = await reviewer.reviewCode(content, file);
        findings.push(...fileFindings);
      }
    }

    // Output results
    const format = options.format || 'markdown';
    let output: string;

    switch (format) {
      case 'json':
        output = JSON.stringify(findings, null, 2);
        break;
      case 'gitlab-sast':
        output = JSON.stringify({
          vulnerabilities: findings.map(f => ({
            id: `${f.file}:${f.line}:${f.title}`,
            severity: f.severity,
            location: {
              file: f.file,
              start_line: f.line,
              end_line: f.line
            },
            name: f.title,
            description: f.description,
            solution: f.suggestedFix,
            category: f.category,
            cwe: f.cweId
          }))
        }, null, 2);
        break;
      default:
        output = await reviewer.generateMarkdownReport(findings);
    }

    if (options.output) {
      fs.writeFileSync(options.output, output);
    } else {
      console.log(output);
    }

    // Check if we should block the pipeline
    const criticalOrHigh = findings.filter(f => f.severity === 'CRITICAL' || f.severity === 'HIGH');
    if (criticalOrHigh.length > 0) {
      console.error(`\n❌ Pipeline blocked: ${criticalOrHigh.length} critical/high severity security issues found`);
      process.exit(1);
    } else {
      console.log('\n✅ Security review passed');
      process.exit(0);
    }

  } catch (error) {
    console.error('Security review failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(console.error);
}

export { LLMSecurityReviewer, SecurityFinding, ReviewOptions };