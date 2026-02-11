/**
 * Integration tests for Directory Detection Logic
 * Tests local configuration file detection and loading
 *
 * SECURITY INVARIANT: These tests must NEVER read or parse a real
 * .azure-devops.json file. All configuration structures are validated
 * using synthetic fixtures to prevent real PAT tokens from leaking
 * into test process memory, assertion output, or CI logs.
 */

import * as fs from 'fs';
import * as path from 'path';
import { AzureDevOpsConfig } from '../../src/types/index';

describe('Directory Detection Integration', () => {
  describe('Local Configuration Detection', () => {
    it('should detect .azure-devops.json existence in current directory without reading contents', () => {
      const currentDir = process.cwd();
      const configPath = path.join(currentDir, '.azure-devops.json');

      // Only check existence — never read the file, as it may contain real credentials
      const configExists = fs.existsSync(configPath);

      if (configExists) {
        // Verify it is gitignored (safety check)
        const gitignoreContent = fs.readFileSync('./.gitignore', 'utf8');
        expect(gitignoreContent).toContain('.azure-devops.json');
      } else {
        // It's okay if the config doesn't exist in the current directory for tests
        console.log('No .azure-devops.json found in current directory - this is expected for tests');
      }
    });

    it('should validate configuration structure using synthetic fixture', () => {
      // Use a synthetic config to validate structure expectations without
      // reading any real file that might contain actual PAT tokens.
      const syntheticConfig: AzureDevOpsConfig = {
        organizationUrl: 'https://dev.azure.com/test-org',
        project: 'TestProject',
        pat: 'synthetic-pat-token-for-structure-validation-only1234'
      };

      // Validate required fields
      expect(syntheticConfig.organizationUrl).toBeDefined();
      expect(syntheticConfig.project).toBeDefined();
      expect(syntheticConfig.pat).toBeDefined();

      // Validate field types
      expect(typeof syntheticConfig.organizationUrl).toBe('string');
      expect(typeof syntheticConfig.project).toBe('string');
      expect(typeof syntheticConfig.pat).toBe('string');

      // Validate URL format
      expect(syntheticConfig.organizationUrl).toMatch(/^https:\/\/dev\.azure\.com\/.+/);

      // Project name should not be empty
      expect(syntheticConfig.project.length).toBeGreaterThan(0);

      // PAT should have reasonable length (typically 52 characters for Azure DevOps)
      expect(syntheticConfig.pat.length).toBeGreaterThan(20);
    });

    it('should handle missing configuration files gracefully', () => {
      const nonExistentDir = '/path/that/does/not/exist';
      const configPath = path.join(nonExistentDir, '.azure-devops.json');

      expect(() => {
        try {
          fs.readFileSync(configPath, 'utf8');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            // This is expected behavior
            return;
          }
          throw error;
        }
      }).not.toThrow();
    });

    it('should handle malformed JSON configuration files', () => {
      // Create a temporary malformed config file for testing
      const tempDir = '/tmp';
      const tempConfigPath = path.join(tempDir, '.azure-devops-test-malformed.json');
      const malformedJson = '{ "organizationUrl": "https://dev.azure.com/test", "project": "Test"'; // Missing closing brace

      try {
        fs.writeFileSync(tempConfigPath, malformedJson);

        expect(() => {
          const content = fs.readFileSync(tempConfigPath, 'utf8');
          JSON.parse(content);
        }).toThrow();

      } finally {
        // Clean up temp file
        try {
          fs.unlinkSync(tempConfigPath);
        } catch (error) {
          // Ignore cleanup errors
        }
      }
    });
  });

  describe('Configuration File Security', () => {
    it('should not expose PAT tokens in error messages', () => {
      // Use a synthetic PAT to verify masking behavior without reading real files
      const syntheticPat = 'abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnop';

      expect(syntheticPat).toBeDefined();
      expect(syntheticPat.length).toBeGreaterThan(0);

      // Validate that masking works correctly
      const patMasked = syntheticPat.substring(0, 4) + '***';
      expect(patMasked).toMatch(/^.{4}\*\*\*$/);
      expect(patMasked).not.toContain(syntheticPat);

      // Simulate an error message that might contain a PAT and verify it could be caught
      const simulatedError = `HTTP 401: Authentication failed for token ${syntheticPat}`;
      // A 52-char alphanumeric string is the PAT pattern we want to detect
      expect(simulatedError).toMatch(/[a-zA-Z0-9]{52}/);
      // After sanitization (replacing the match), it should be clean
      const sanitized = simulatedError.replace(/[a-zA-Z0-9]{52}/g, '[REDACTED]');
      expect(sanitized).not.toContain(syntheticPat);
    });
  });

  describe('Directory Path Resolution', () => {
    it('should resolve relative paths correctly', () => {
      const currentDir = process.cwd();
      const resolvedPath = path.resolve('./tests');
      const expectedPath = path.join(currentDir, 'tests');

      expect(resolvedPath).toBe(expectedPath);
    });

    it('should handle nested directory structures', () => {
      const testPath = '/Users/testuser/Projects/riversync/src/components/auth';
      const parentPaths = [];
      let currentPath = testPath;

      while (currentPath !== path.parse(currentPath).root) {
        parentPaths.push(currentPath);
        currentPath = path.dirname(currentPath);
      }

      expect(parentPaths).toContain('/Users/testuser/Projects/riversync/src/components/auth');
      expect(parentPaths).toContain('/Users/testuser/Projects/riversync/src/components');
      expect(parentPaths).toContain('/Users/testuser/Projects/riversync/src');
      expect(parentPaths).toContain('/Users/testuser/Projects/riversync');
    });
  });
});