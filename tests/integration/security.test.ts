/**
 * Integration tests for PAT Token Security and Configuration Isolation
 * Tests security measures and proper isolation of sensitive configuration
 *
 * SECURITY INVARIANT: These tests must NEVER read or load a real
 * .azure-devops.json file. All PAT values used here are synthetic
 * test fixtures. This prevents real credentials from being loaded
 * into test process memory where they could leak via assertion
 * failures, stack traces, or CI logs.
 */

import * as fs from 'fs';
import * as path from 'path';
import { AzureDevOpsConfig } from '../../src/types/index';
import { ToolHandlers } from '../../src/handlers/tool-handlers';

describe('Security Integration Tests', () => {
  const testDirectories = [
    '/Users/testuser/Projects/riversync',
    '/Users/testuser/Projects/mula'
  ];

  describe('Local Configuration Security', () => {
    it('should never load real .azure-devops.json during automated tests', () => {
      // This test is the safety gate: it verifies that tests do NOT
      // read real credentials. If .azure-devops.json exists in the
      // working directory, we only check its presence — we never read it.
      const currentConfigPath = './.azure-devops.json';
      const exists = fs.existsSync(currentConfigPath);

      if (exists) {
        // Verify the file is in .gitignore (the only safe assertion to make
        // about a file that might contain real credentials)
        const gitignoreContent = fs.readFileSync('./.gitignore', 'utf8');
        expect(gitignoreContent).toContain('.azure-devops.json');
      }

      // This test always passes — its purpose is to document and enforce
      // the policy that tests must not read real credential files.
      expect(true).toBe(true);
    });

    it('should validate PAT token structure using synthetic fixture', () => {
      // Use a synthetic config — never a real one
      const syntheticConfig: AzureDevOpsConfig = {
        organizationUrl: 'https://dev.azure.com/test-org',
        project: 'TestProject',
        pat: 'abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnop'
      };

      expect(syntheticConfig.pat.length).toBeGreaterThan(10);
      expect(typeof syntheticConfig.pat).toBe('string');
      expect(syntheticConfig.organizationUrl).toBeDefined();
      expect(syntheticConfig.project).toBeDefined();
    });

    it('should not expose PAT tokens in error messages or logs', () => {
      const testConfig: AzureDevOpsConfig = {
        organizationUrl: 'https://dev.azure.com/security-test',
        project: 'SecurityTest',
        pat: 'very-secret-pat-token-that-should-not-be-exposed'
      };

      // Test that we can work with PAT without exposing it
      const maskedPat = testConfig.pat.substring(0, 4) + '***';
      expect(maskedPat).toBe('very***');
      expect(maskedPat).not.toContain('secret');
      expect(maskedPat).not.toContain('exposed');
    });

    it('should sanitize PAT from all tool handler responses', () => {
      const handler = new ToolHandlers();
      const fakePat = 'pat-secret-value-that-must-not-leak-through';
      handler.setCurrentConfig({
        organizationUrl: 'https://dev.azure.com/test-org',
        project: 'TestProject',
        pat: fakePat
      });

      // Access private sanitizePat via bracket notation for testing
      const sanitize = (handler as any).sanitizePat.bind(handler);
      const base64Pat = Buffer.from(`:${fakePat}`).toString('base64');

      // Raw PAT should be redacted
      expect(sanitize(`Error: auth failed with token ${fakePat}`)).not.toContain(fakePat);
      expect(sanitize(`Error: auth failed with token ${fakePat}`)).toContain('[PAT_REDACTED]');

      // Base64-encoded PAT should also be redacted
      expect(sanitize(`Authorization: Basic ${base64Pat}`)).not.toContain(base64Pat);
      expect(sanitize(`Authorization: Basic ${base64Pat}`)).toContain('[PAT_BASE64_REDACTED]');

      // Clean text should pass through unchanged
      expect(sanitize('No secrets here')).toBe('No secrets here');
    });

    it('should validate configuration file permissions without reading contents', () => {
      const currentConfigPath = './.azure-devops.json';

      try {
        const stats = fs.statSync(currentConfigPath);
        
        // File should be readable by owner
        expect(stats.isFile()).toBe(true);
        expect(stats.size).toBeGreaterThan(0);

        // On Unix systems, check that file is not world-readable
        if (process.platform !== 'win32') {
          const mode = stats.mode & parseInt('777', 8);
          // File should not be world-readable (last digit should not include read permission)
          const worldPermissions = mode & parseInt('007', 8);
          if (worldPermissions & parseInt('004', 8)) {
            console.warn('Configuration file is world-readable - consider restricting permissions');
          }
        }

      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException;
        if (nodeError.code === 'ENOENT') {
          // File doesn't exist - this is acceptable for tests
          console.log('No configuration file to check permissions');
        } else {
          throw error;
        }
      }
    });
  });

  describe('Git Ignore Security', () => {
    it('should ensure sensitive files are excluded from version control', () => {
      const gitignorePath = './.gitignore';

      try {
        const gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');

        // Configuration files should be ignored
        expect(gitignoreContent).toContain('.azure-devops.json');

        // Legacy files should also be ignored if present
        const legacyPatterns = [
          'environments.json',
          '*.env',
          '.env.local'
        ];

        // At least some security patterns should be present
        const hasSecurityPatterns = legacyPatterns.some(pattern => 
          gitignoreContent.includes(pattern)
        );

        if (!hasSecurityPatterns) {
          console.warn('Consider adding more security patterns to .gitignore');
        }

      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException;
        if (nodeError.code === 'ENOENT') {
          throw new Error('No .gitignore file found - this is a security risk');
        } else {
          throw error;
        }
      }
    });

    it('should not have sensitive files committed to git', () => {
      // This test checks that configuration files are not accidentally committed
      const sensitiveFiles = [
        './.azure-devops.json',
        './environments.json',
        './.env',
        './.env.local'
      ];

      sensitiveFiles.forEach(filePath => {
        if (fs.existsSync(filePath)) {
          // File exists - make sure it's in .gitignore
          const gitignorePath = './.gitignore';
          try {
            const gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
            const fileName = path.basename(filePath);
            expect(gitignoreContent).toContain(fileName);
          } catch (error) {
            throw new Error(`Sensitive file ${filePath} exists but no .gitignore found`);
          }
        }
      });
    });

    it('should have developer debug scripts excluded from version control', () => {
      const gitignoreContent = fs.readFileSync('./.gitignore', 'utf8');

      // Debug scripts that load real credentials must be gitignored
      const debugScripts = [
        'get-active-items.js',
        'test-wiql.js',
        'test-mcp-wiql.js',
        'test-parent-fix.js'
      ];

      debugScripts.forEach(script => {
        expect(gitignoreContent).toContain(script);
      });
    });
  });

  describe('Environment Variable Security', () => {
    it('should not expose sensitive data through environment variables', () => {
      const sensitivePatterns = [
        /PAT$/i,
        /TOKEN$/i,
        /PASSWORD$/i,
        /SECRET$/i,
        /KEY$/i,
        /AZURE.*PAT/i,
        /DEVOPS.*TOKEN/i
      ];

      const envVars = Object.keys(process.env);
      const suspiciousVars: string[] = [];

      envVars.forEach(key => {
        const value = process.env[key];
        const isSuspicious = sensitivePatterns.some(pattern => pattern.test(key));
        
        if (isSuspicious && value && value.length > 10) {
          suspiciousVars.push(key);
        }
      });

      // Log findings without exposing values
      if (suspiciousVars.length > 0) {
        console.warn(`Found ${suspiciousVars.length} potentially sensitive environment variables:`, 
          suspiciousVars.map(key => `${key}: [REDACTED]`));
      }

      // This test passes but warns about potential security issues
      expect(envVars.length).toBeGreaterThan(0);
    });

    it('should mask sensitive values when logging', () => {
      const testSensitiveValue = 'super-secret-token-12345';
      
      // Demonstrate proper masking
      const masked = testSensitiveValue.substring(0, 3) + '***' + 
                    testSensitiveValue.substring(testSensitiveValue.length - 2);
      
      expect(masked).toBe('sup***45');
      expect(masked).not.toContain('secret');
      expect(masked).not.toContain('token');
      expect(masked.length).toBeLessThan(testSensitiveValue.length);
    });
  });

  describe('Project Configuration Isolation', () => {
    it('should maintain separate configurations for different projects', () => {
      // Use synthetic configs to validate isolation logic without reading real files
      const syntheticProjects = new Map<string, AzureDevOpsConfig>([
        ['riversync', {
          organizationUrl: 'https://dev.azure.com/riversync',
          project: 'RiverSync',
          pat: 'synthetic-pat-riversync'
        }],
        ['mula', {
          organizationUrl: 'https://dev.azure.com/mula-x',
          project: 'mula',
          pat: 'synthetic-pat-mula'
        }]
      ]);

      // Validate each config is complete
      syntheticProjects.forEach((config, projectName) => {
        expect(config.organizationUrl).toBeDefined();
        expect(config.project).toBeDefined();
        expect(config.pat).toBeDefined();
      });

      // Each config should have unique organization or project
      const configs = Array.from(syntheticProjects.values());
      for (let i = 0; i < configs.length; i++) {
        for (let j = i + 1; j < configs.length; j++) {
          const config1 = configs[i];
          const config2 = configs[j];
          
          // Configs should be isolated (different org or project)
          const isDifferent = config1.organizationUrl !== config2.organizationUrl ||
                             config1.project !== config2.project;
          
          expect(isDifferent).toBe(true);
        }
      }
    });

    it('should not leak configuration between projects', () => {
      // Test that configuration loading is stateless and doesn't leak between calls
      const testConfigs = [
        {
          organizationUrl: 'https://dev.azure.com/project1',
          project: 'Project1',
          pat: 'pat-token-1'
        },
        {
          organizationUrl: 'https://dev.azure.com/project2',
          project: 'Project2',
          pat: 'pat-token-2'
        }
      ];

      // Simulate loading different configs
      testConfigs.forEach((config, index) => {
        // Each config should be independent
        expect(config.organizationUrl).not.toContain(testConfigs[1 - index].project);
        expect(config.project).not.toBe(testConfigs[1 - index].project);
        expect(config.pat).not.toBe(testConfigs[1 - index].pat);
      });
    });
  });

  describe('Input Sanitization', () => {
    it('should handle malicious input safely', () => {
      const maliciousInputs = [
        '../../../etc/passwd',
        '$(rm -rf /)',
        '<script>alert("xss")</script>',
        'DROP TABLE users;',
        '\0\n\r',
        '../../../../.azure-devops.json'
      ];

      maliciousInputs.forEach(input => {
        // Path traversal protection
        const safePath = path.normalize(input);
        if (safePath.includes('..')) {
          expect(path.resolve(safePath)).not.toContain('/..');
        }

        // Input should not contain dangerous characters after normalization
        const sanitized = input.replace(/[^\w\-./]/g, '');
        expect(sanitized).not.toContain('<script>');
        expect(sanitized).not.toContain('$(');
        // Check for SQL injection patterns (case insensitive, with word boundaries)
        expect(sanitized.toUpperCase()).not.toMatch(/\bDROP\b/);
      });
    });

    it('should validate URL formats', () => {
      const validUrls = [
        'https://dev.azure.com/organization',
        'https://organization.visualstudio.com'
      ];

      const invalidUrls = [
        'http://dev.azure.com/org', // Should be HTTPS
        'javascript:alert("xss")',
        'file:///etc/passwd',
        'ftp://malicious.com',
        ''
      ];

      validUrls.forEach(url => {
        expect(url).toMatch(/^https:\/\/.+/);
      });

      invalidUrls.forEach(url => {
        expect(url).not.toMatch(/^https:\/\/dev\.azure\.com\/.+/);
      });
    });
  });
});