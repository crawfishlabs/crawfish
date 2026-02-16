#!/usr/bin/env node

/**
 * Secret Scanner for Claw Applications
 * 
 * Scans for leaked secrets, API keys, passwords, and other sensitive information
 * in code, configuration files, and git history.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import * as crypto from 'crypto';

interface SecretPattern {
  name: string;
  pattern: RegExp;
  severity: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  falsePositivePatterns?: RegExp[];
}

interface SecretFinding {
  id: string;
  file: string;
  line: number;
  column: number;
  match: string;
  maskedMatch: string;
  pattern: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  confidence: 'high' | 'medium' | 'low';
  gitCommit?: string;
  author?: string;
  date?: string;
  remediation: string;
}

interface ScanOptions {
  workingDir?: string;
  includeHistory?: boolean;
  outputFile?: string;
  format?: 'json' | 'markdown' | 'gitlab-sast';
  excludePaths?: string[];
  preCommit?: boolean;
}

class SecretScanner {
  private secretPatterns: SecretPattern[] = [
    // API Keys
    {
      name: 'Generic API Key',
      pattern: /(?:api[_-]?key|apikey|key|secret)[=:\s]+"?([a-zA-Z0-9_\-]{20,})"?/gi,
      severity: 'high',
      description: 'Generic API key pattern detected',
      falsePositivePatterns: [
        /example/i,
        /test/i,
        /fake/i,
        /placeholder/i,
        /your[_-]key/i,
        /REPLACE/i
      ]
    },
    
    // Firebase
    {
      name: 'Firebase API Key',
      pattern: /AIza[0-9A-Za-z_\-]{35}/g,
      severity: 'critical',
      description: 'Firebase API key detected - should be in environment variables'
    },
    
    // Anthropic API Key
    {
      name: 'Anthropic API Key',
      pattern: /sk-ant-[a-zA-Z0-9_\-]{95,}/g,
      severity: 'critical',
      description: 'Anthropic API key detected'
    },
    
    // Plaid API Keys
    {
      name: 'Plaid Secret Key',
      pattern: /[a-f0-9]{64}/g,
      severity: 'critical',
      description: 'Potential Plaid secret key (64 hex chars)'
    },
    
    // JWT Secrets
    {
      name: 'JWT Secret',
      pattern: /jwt[_-]?secret[=:\s]+"?([a-zA-Z0-9_\-+/=]{32,})"?/gi,
      severity: 'high',
      description: 'JWT secret key detected'
    },
    
    // Database URLs with credentials
    {
      name: 'Database URL with Credentials',
      pattern: /(?:mongodb|mysql|postgres|postgresql):\/\/[^:]+:[^@]+@[^\/\s]+/gi,
      severity: 'critical',
      description: 'Database URL with embedded credentials'
    },
    
    // Private Keys
    {
      name: 'Private Key',
      pattern: /-----BEGIN[A-Z\s]+PRIVATE KEY-----[\s\S]*?-----END[A-Z\s]+PRIVATE KEY-----/g,
      severity: 'critical',
      description: 'Private key detected'
    },
    
    // SSH Private Keys
    {
      name: 'SSH Private Key',
      pattern: /-----BEGIN OPENSSH PRIVATE KEY-----[\s\S]*?-----END OPENSSH PRIVATE KEY-----/g,
      severity: 'critical',
      description: 'SSH private key detected'
    },
    
    // AWS Keys
    {
      name: 'AWS Access Key ID',
      pattern: /AKIA[0-9A-Z]{16}/g,
      severity: 'critical',
      description: 'AWS Access Key ID detected'
    },
    
    {
      name: 'AWS Secret Access Key',
      pattern: /[a-zA-Z0-9+/]{40}/g,
      severity: 'high',
      description: 'Potential AWS Secret Access Key (40 base64 chars)'
    },
    
    // Google Cloud
    {
      name: 'Google Cloud Service Account',
      pattern: /"private_key":\s*"-----BEGIN PRIVATE KEY-----[\s\S]*?-----END PRIVATE KEY-----"/g,
      severity: 'critical',
      description: 'Google Cloud Service Account private key'
    },
    
    // Generic passwords
    {
      name: 'Hardcoded Password',
      pattern: /(?:password|pwd|pass)[=:\s]+"?([^"\s]{8,})"?/gi,
      severity: 'medium',
      description: 'Hardcoded password detected',
      falsePositivePatterns: [
        /password/i,
        /\*+/,
        /x+/i,
        /example/i,
        /placeholder/i
      ]
    },
    
    // OAuth tokens
    {
      name: 'OAuth Token',
      pattern: /(?:oauth|bearer|token)[=:\s]+"?([a-zA-Z0-9_\-\.]{30,})"?/gi,
      severity: 'high',
      description: 'OAuth or Bearer token detected'
    },
    
    // Slack tokens
    {
      name: 'Slack Token',
      pattern: /xox[baprs]-[0-9a-zA-Z\-]{10,}/g,
      severity: 'high',
      description: 'Slack API token detected'
    },
    
    // Credit card numbers (basic pattern)
    {
      name: 'Credit Card Number',
      pattern: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|3[0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b/g,
      severity: 'critical',
      description: 'Potential credit card number detected'
    },
    
    // Email addresses in sensitive contexts
    {
      name: 'Email in Config',
      pattern: /(?:admin|root|service)[_-]?email[=:\s]+"?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})"?/gi,
      severity: 'low',
      description: 'Email address in configuration'
    }
  ];

  private defaultExcludePaths = [
    'node_modules',
    '.git',
    '*.log',
    '*.lock',
    'build',
    'dist',
    'coverage',
    '*.map',
    '*.min.js',
    '*.bundle.js'
  ];

  async scanDirectory(directory: string, options: ScanOptions = {}): Promise<SecretFinding[]> {
    const findings: SecretFinding[] = [];
    const excludePaths = [...this.defaultExcludePaths, ...(options.excludePaths || [])];
    
    const files = this.getFilesToScan(directory, excludePaths);
    console.log(`Scanning ${files.length} files for secrets...`);
    
    for (const file of files) {
      const fileFindings = await this.scanFile(file);
      findings.push(...fileFindings);
    }
    
    // Include git history scan if requested
    if (options.includeHistory) {
      const historyFindings = await this.scanGitHistory(directory);
      findings.push(...historyFindings);
    }
    
    return this.deduplicateFindings(findings);
  }

  private getFilesToScan(directory: string, excludePaths: string[]): string[] {
    const files: string[] = [];
    
    const walk = (dir: string): void => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(directory, fullPath);
        
        // Check if path should be excluded
        if (excludePaths.some(pattern => {
          if (pattern.includes('*')) {
            const regex = new RegExp(pattern.replace(/\*/g, '.*'));
            return regex.test(relativePath);
          }
          return relativePath.includes(pattern);
        })) {
          continue;
        }
        
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile()) {
          // Only scan text files
          if (this.isTextFile(fullPath)) {
            files.push(fullPath);
          }
        }
      }
    };
    
    walk(directory);
    return files;
  }

  private isTextFile(filePath: string): boolean {
    const textExtensions = [
      '.js', '.ts', '.jsx', '.tsx', '.json', '.yml', '.yaml',
      '.env', '.config', '.conf', '.ini', '.properties',
      '.md', '.txt', '.csv', '.sql', '.sh', '.py', '.java',
      '.swift', '.go', '.rb', '.php', '.html', '.css', '.xml',
      '.toml', '.lock', '.gitignore', '.dockerignore'
    ];
    
    const ext = path.extname(filePath).toLowerCase();
    if (textExtensions.includes(ext)) return true;
    
    // Check for common config files without extensions
    const basename = path.basename(filePath);
    const configFiles = [
      'Dockerfile', 'Makefile', 'Rakefile', 'Gemfile',
      '.env', '.env.local', '.env.development', '.env.production',
      'config', 'credentials'
    ];
    
    return configFiles.includes(basename);
  }

  private async scanFile(filePath: string): Promise<SecretFinding[]> {
    const findings: SecretFinding[] = [];
    
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n');
      
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const line = lines[lineIndex];
        
        for (const pattern of this.secretPatterns) {
          const matches = [...line.matchAll(pattern.pattern)];
          
          for (const match of matches) {
            if (this.isFalsePositive(match[0], pattern)) {
              continue;
            }
            
            const finding: SecretFinding = {
              id: this.generateFindingId(filePath, lineIndex, match.index || 0, pattern.name),
              file: filePath,
              line: lineIndex + 1,
              column: (match.index || 0) + 1,
              match: match[0],
              maskedMatch: this.maskSecret(match[0]),
              pattern: pattern.name,
              severity: pattern.severity,
              description: pattern.description,
              confidence: this.calculateConfidence(match[0], pattern),
              remediation: this.getRemediationAdvice(pattern)
            };
            
            findings.push(finding);
          }
        }
      }
    } catch (error) {
      console.error(`Error scanning file ${filePath}:`, error);
    }
    
    return findings;
  }

  private async scanGitHistory(directory: string): Promise<SecretFinding[]> {
    const findings: SecretFinding[] = [];
    
    try {
      // Get all commits
      const commits = execSync('git log --oneline --all', { 
        cwd: directory, 
        encoding: 'utf8' 
      }).trim().split('\n');
      
      console.log(`Scanning ${commits.length} git commits for secrets...`);
      
      // Limit to last 100 commits for performance
      const recentCommits = commits.slice(0, 100);
      
      for (const commit of recentCommits) {
        const commitHash = commit.split(' ')[0];
        
        try {
          // Get the diff for this commit
          const diff = execSync(`git show ${commitHash} --format=""`, { 
            cwd: directory, 
            encoding: 'utf8',
            maxBuffer: 5 * 1024 * 1024 // 5MB limit
          });
          
          const historyFindings = this.scanDiffContent(diff, commitHash, directory);
          findings.push(...historyFindings);
        } catch (error) {
          // Skip commits that are too large or cause errors
          console.warn(`Skipping commit ${commitHash}: ${error}`);
        }
      }
    } catch (error) {
      console.warn('Git history scan failed:', error);
    }
    
    return findings;
  }

  private scanDiffContent(diff: string, commitHash: string, workingDir: string): SecretFinding[] {
    const findings: SecretFinding[] = [];
    const lines = diff.split('\n');
    
    let currentFile = '';
    let lineNumber = 0;
    
    for (const line of lines) {
      if (line.startsWith('diff --git')) {
        const match = line.match(/diff --git a\/(.*?) b\//);
        currentFile = match ? match[1] : '';
        lineNumber = 0;
      } else if (line.startsWith('@@')) {
        const match = line.match(/@@ -\d+,?\d* \+(\d+),?\d* @@/);
        lineNumber = match ? parseInt(match[1]) - 1 : 0;
      } else if (line.startsWith('+') && !line.startsWith('+++')) {
        lineNumber++;
        const content = line.slice(1); // Remove the '+' prefix
        
        for (const pattern of this.secretPatterns) {
          const matches = [...content.matchAll(pattern.pattern)];
          
          for (const match of matches) {
            if (this.isFalsePositive(match[0], pattern)) {
              continue;
            }
            
            // Get commit details
            const commitDetails = this.getCommitDetails(commitHash, workingDir);
            
            const finding: SecretFinding = {
              id: this.generateFindingId(currentFile, lineNumber, match.index || 0, pattern.name, commitHash),
              file: currentFile,
              line: lineNumber,
              column: (match.index || 0) + 1,
              match: match[0],
              maskedMatch: this.maskSecret(match[0]),
              pattern: pattern.name,
              severity: pattern.severity,
              description: `${pattern.description} (found in git history)`,
              confidence: this.calculateConfidence(match[0], pattern),
              gitCommit: commitHash,
              author: commitDetails.author,
              date: commitDetails.date,
              remediation: `${this.getRemediationAdvice(pattern)}. Also consider rewriting git history to remove this secret.`
            };
            
            findings.push(finding);
          }
        }
      }
    }
    
    return findings;
  }

  private getCommitDetails(commitHash: string, workingDir: string): { author: string; date: string } {
    try {
      const author = execSync(`git show -s --format='%an' ${commitHash}`, { 
        cwd: workingDir, 
        encoding: 'utf8' 
      }).trim();
      
      const date = execSync(`git show -s --format='%ai' ${commitHash}`, { 
        cwd: workingDir, 
        encoding: 'utf8' 
      }).trim();
      
      return { author, date };
    } catch {
      return { author: 'Unknown', date: 'Unknown' };
    }
  }

  private isFalsePositive(match: string, pattern: SecretPattern): boolean {
    if (!pattern.falsePositivePatterns) return false;
    
    return pattern.falsePositivePatterns.some(fp => fp.test(match));
  }

  private maskSecret(secret: string): string {
    if (secret.length <= 8) {
      return '*'.repeat(secret.length);
    }
    
    const start = secret.slice(0, 4);
    const end = secret.slice(-4);
    const middle = '*'.repeat(secret.length - 8);
    
    return start + middle + end;
  }

  private calculateConfidence(match: string, pattern: SecretPattern): 'high' | 'medium' | 'low' {
    // High confidence for well-defined patterns
    if (pattern.name.includes('Firebase') || 
        pattern.name.includes('Anthropic') ||
        pattern.name.includes('Private Key')) {
      return 'high';
    }
    
    // Medium confidence for longer matches
    if (match.length > 30) {
      return 'medium';
    }
    
    return 'low';
  }

  private getRemediationAdvice(pattern: SecretPattern): string {
    const baseAdvice = {
      'Firebase API Key': 'Move to environment variables. Ensure Firebase security rules are properly configured.',
      'Anthropic API Key': 'Move to environment variables. Rotate the key immediately.',
      'Private Key': 'Remove from code. Store securely in key management system.',
      'Database URL with Credentials': 'Use environment variables for database credentials.',
      'JWT Secret': 'Move to environment variables. Use a strong, randomly generated secret.',
      'Hardcoded Password': 'Remove hardcoded password. Use secure authentication methods.',
      'AWS Access Key ID': 'Remove from code. Use IAM roles or environment variables.',
      'OAuth Token': 'Move to secure storage. Implement token refresh logic.',
    };
    
    return baseAdvice[pattern.name] || 'Move sensitive data to environment variables or secure storage.';
  }

  private generateFindingId(
    file: string, 
    line: number, 
    column: number, 
    pattern: string, 
    commit?: string
  ): string {
    const data = `${file}:${line}:${column}:${pattern}:${commit || ''}`;
    return crypto.createHash('md5').update(data).digest('hex').slice(0, 12);
  }

  private deduplicateFindings(findings: SecretFinding[]): SecretFinding[] {
    const seen = new Set<string>();
    return findings.filter(finding => {
      const key = `${finding.file}:${finding.line}:${finding.pattern}:${finding.maskedMatch}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  generateMarkdownReport(findings: SecretFinding[]): string {
    if (findings.length === 0) {
      return '# Secret Scan Report\n\n✅ No secrets detected in codebase.\n';
    }

    const critical = findings.filter(f => f.severity === 'critical');
    const high = findings.filter(f => f.severity === 'high');
    const medium = findings.filter(f => f.severity === 'medium');
    const low = findings.filter(f => f.severity === 'low');

    let report = '# Secret Scan Report\n\n';
    report += '🔍 **This scan detected potential secrets in your codebase.**\n\n';
    
    report += `## Summary\n\n`;
    report += `- 🔴 Critical: ${critical.length}\n`;
    report += `- 🟠 High: ${high.length}\n`;
    report += `- 🟡 Medium: ${medium.length}\n`;
    report += `- 🔵 Low: ${low.length}\n\n`;

    if (critical.length > 0 || high.length > 0) {
      report += '⚠️ **URGENT ACTION REQUIRED**: Critical or high-severity secrets detected.\n\n';
    }

    const sections = [
      { title: '🔴 Critical Secrets', findings: critical },
      { title: '🟠 High-Risk Secrets', findings: high },
      { title: '🟡 Medium-Risk Secrets', findings: medium },
      { title: '🔵 Low-Risk Secrets', findings: low }
    ];

    for (const section of sections) {
      if (section.findings.length > 0) {
        report += `## ${section.title}\n\n`;
        
        for (const finding of section.findings) {
          report += `### ${finding.pattern}\n\n`;
          report += `- **File**: ${finding.file}:${finding.line}:${finding.column}\n`;
          report += `- **Severity**: ${finding.severity.toUpperCase()}\n`;
          report += `- **Confidence**: ${finding.confidence.toUpperCase()}\n`;
          report += `- **Found**: ${finding.maskedMatch}\n`;
          
          if (finding.gitCommit) {
            report += `- **Git Commit**: ${finding.gitCommit}\n`;
            report += `- **Author**: ${finding.author}\n`;
            report += `- **Date**: ${finding.date}\n`;
          }
          
          report += `\n**Description**: ${finding.description}\n\n`;
          report += `**Remediation**: ${finding.remediation}\n\n`;
          report += '---\n\n';
        }
      }
    }

    report += `## Immediate Actions Required\n\n`;
    
    if (critical.length > 0) {
      report += `🚨 **CRITICAL**: ${critical.length} critical secrets found\n`;
      report += `1. **IMMEDIATELY** rotate any exposed API keys or credentials\n`;
      report += `2. Remove secrets from code and move to environment variables\n`;
      report += `3. Check if these secrets have been used maliciously\n`;
      report += `4. Consider rewriting git history to remove secrets\n\n`;
    }
    
    if (high.length > 0) {
      report += `⚠️ **HIGH PRIORITY**: ${high.length} high-risk secrets found\n`;
      report += `1. Rotate credentials within 24 hours\n`;
      report += `2. Move to secure storage\n`;
      report += `3. Review access logs for unusual activity\n\n`;
    }
    
    report += `## Prevention\n\n`;
    report += `1. **Pre-commit hooks**: Install secret scanning in git hooks\n`;
    report += `2. **Environment variables**: Use .env files (never commit them)\n`;
    report += `3. **Secret management**: Use services like AWS Secrets Manager or Azure Key Vault\n`;
    report += `4. **Code review**: Always review code changes for hardcoded secrets\n`;
    report += `5. **CI/CD scanning**: Include secret scanning in your pipeline\n\n`;

    report += `## Tools Used\n\n`;
    report += `- Custom secret patterns for Claw apps\n`;
    report += `- Git history analysis\n`;
    report += `- False positive filtering\n`;
    report += `- Confidence scoring\n\n`;

    return report;
  }

  async installPreCommitHook(workingDir: string): Promise<void> {
    const hookPath = path.join(workingDir, '.git', 'hooks', 'pre-commit');
    const hookContent = `#!/bin/bash
# Secret scanning pre-commit hook
echo "🔍 Scanning for secrets..."

# Get staged files
staged_files=$(git diff --cached --name-only --diff-filter=ACM)

if [ -z "$staged_files" ]; then
  echo "No staged files to scan"
  exit 0
fi

# Run secret scanner on staged files only
node ../claw-platform/security/secret-scanner.js --pre-commit

exit_code=$?

if [ $exit_code -ne 0 ]; then
  echo ""
  echo "❌ Secret scan failed! Commit blocked."
  echo "Fix the issues above and try again."
  echo ""
  echo "To skip this check (NOT RECOMMENDED):"
  echo "git commit --no-verify"
  exit 1
fi

echo "✅ Secret scan passed"
exit 0
`;

    fs.writeFileSync(hookPath, hookContent, { mode: 0o755 });
    console.log('✅ Pre-commit hook installed');
  }
}

async function main() {
  const args = process.argv.slice(2);
  const options: ScanOptions = {};

  // Parse command line arguments
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.replace('--', '');
    const value = args[i + 1];
    
    switch (key) {
      case 'working-dir':
        options.workingDir = value;
        break;
      case 'include-history':
        options.includeHistory = value === 'true';
        break;
      case 'output':
        options.outputFile = value;
        break;
      case 'format':
        options.format = value as 'json' | 'markdown' | 'gitlab-sast';
        break;
      case 'exclude':
        options.excludePaths = value ? value.split(',') : [];
        break;
      case 'pre-commit':
        options.preCommit = true;
        break;
    }
  }

  const scanner = new SecretScanner();
  const workingDir = options.workingDir || process.cwd();

  try {
    let findings: SecretFinding[] = [];

    if (options.preCommit) {
      // Pre-commit mode: only scan staged files
      const stagedFiles = execSync('git diff --cached --name-only --diff-filter=ACM', { 
        cwd: workingDir, 
        encoding: 'utf8' 
      }).trim().split('\n').filter(f => f);

      console.log(`Scanning ${stagedFiles.length} staged files...`);
      
      for (const file of stagedFiles) {
        const fullPath = path.join(workingDir, file);
        if (fs.existsSync(fullPath)) {
          const fileFindings = await scanner['scanFile'](fullPath);
          findings.push(...fileFindings);
        }
      }
    } else {
      // Normal mode: scan entire directory
      findings = await scanner.scanDirectory(workingDir, options);
    }

    console.log(`Found ${findings.length} potential secrets`);

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
            id: f.id,
            severity: f.severity.toUpperCase(),
            name: f.pattern,
            description: f.description,
            location: {
              file: f.file,
              start_line: f.line,
              end_line: f.line
            },
            solution: f.remediation
          }))
        }, null, 2);
        break;
      default:
        output = scanner.generateMarkdownReport(findings);
    }

    if (options.outputFile) {
      fs.writeFileSync(options.outputFile, output);
      console.log(`Report written to ${options.outputFile}`);
    } else {
      console.log(output);
    }

    // Exit with appropriate code
    const criticalOrHigh = findings.filter(f => f.severity === 'critical' || f.severity === 'high');
    if (criticalOrHigh.length > 0) {
      console.error(`\n❌ ${criticalOrHigh.length} critical/high severity secrets found`);
      process.exit(1);
    } else if (findings.length > 0) {
      console.log(`\n⚠️  ${findings.length} potential secrets found (medium/low severity)`);
      process.exit(0);
    } else {
      console.log('\n✅ No secrets detected');
      process.exit(0);
    }

  } catch (error) {
    console.error('Secret scanning failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(console.error);
}

export { SecretScanner, SecretFinding, ScanOptions };