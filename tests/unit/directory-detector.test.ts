/**
 * Unit tests for DirectoryDetector
 */

import { DirectoryDetector } from '../../src/directory-detector';
import { AzureDevOpsConfig, ProjectMapping } from '../../src/types/index';

describe('DirectoryDetector', () => {
  let detector: DirectoryDetector;
  let mockMappings: ProjectMapping[];

  beforeEach(() => {
    mockMappings = [
      {
        directory: '/Users/testuser/Projects/riversync',
        config: {
          organizationUrl: 'https://dev.azure.com/riversync',
          pat: 'test-pat-1',
          project: 'RiverSync'
        }
      },
      {
        directory: '/Users/testuser/Projects/mula',
        config: {
          organizationUrl: 'https://dev.azure.com/mula-x',
          pat: 'test-pat-2',
          project: 'mula'
        }
      }
    ];

    detector = new DirectoryDetector(mockMappings);
  });

  describe('detectConfiguration', () => {
    it('should detect RiverSync configuration for exact directory match', () => {
      const config = detector.detectConfiguration('/Users/testuser/Projects/riversync');
      
      expect(config).not.toBeNull();
      expect(config?.project).toBe('RiverSync');
      expect(config?.organizationUrl).toBe('https://dev.azure.com/riversync');
      expect(config?.pat).toBe('test-pat-1');
    });

    it('should detect Mula configuration for exact directory match', () => {
      const config = detector.detectConfiguration('/Users/testuser/Projects/mula');
      
      expect(config).not.toBeNull();
      expect(config?.project).toBe('mula');
      expect(config?.organizationUrl).toBe('https://dev.azure.com/mula-x');
      expect(config?.pat).toBe('test-pat-2');
    });

    it('should detect parent configuration for nested directories', () => {
      const config = detector.detectConfiguration('/Users/testuser/Projects/riversync/src/components');
      
      expect(config).not.toBeNull();
      expect(config?.project).toBe('RiverSync');
      expect(config?.organizationUrl).toBe('https://dev.azure.com/riversync');
    });

    it('should return null for directories with no match', () => {
      const config = detector.detectConfiguration('/Users/testuser/Projects/other-project');
      
      expect(config).toBeNull();
    });

    it('should use current working directory when no directory provided', () => {
      // Mock process.cwd() to return a known path
      const originalCwd = process.cwd;
      process.cwd = jest.fn().mockReturnValue('/Users/testuser/Projects/mula');

      const config = detector.detectConfiguration();
      
      expect(config).not.toBeNull();
      expect(config?.project).toBe('mula');

      // Restore original process.cwd
      process.cwd = originalCwd;
    });

    it('should return most specific match for overlapping paths', () => {
      // Add a more specific mapping
      const specificMappings: ProjectMapping[] = [
        ...mockMappings,
        {
          directory: '/Users/testuser/Projects/riversync/frontend',
          config: {
            organizationUrl: 'https://dev.azure.com/riversync-frontend',
            pat: 'frontend-pat',
            project: 'RiverSync-Frontend'
          }
        }
      ];

      const specificDetector = new DirectoryDetector(specificMappings);
      const config = specificDetector.detectConfiguration('/Users/testuser/Projects/riversync/frontend/components');
      
      expect(config).not.toBeNull();
      expect(config?.project).toBe('RiverSync-Frontend');
    });
  });

  describe('getProjectContext', () => {
    it('should return project context for configured directory', () => {
      const context = detector.getProjectContext('/Users/testuser/Projects/mula');
      
      expect(context).not.toBeNull();
      expect(context?.projectName).toBe('mula');
      expect(context?.organizationUrl).toBe('https://dev.azure.com/mula-x');
    });

    it('should return null for unconfigured directory', () => {
      const context = detector.getProjectContext('/Users/testuser/Projects/unknown');
      
      expect(context).toBeNull();
    });
  });

  describe('isConfiguredDirectory', () => {
    it('should return true for configured directory', () => {
      const isConfigured = detector.isConfiguredDirectory('/Users/testuser/Projects/riversync');
      
      expect(isConfigured).toBe(true);
    });

    it('should return false for unconfigured directory', () => {
      const isConfigured = detector.isConfiguredDirectory('/Users/testuser/Projects/unknown');
      
      expect(isConfigured).toBe(false);
    });
  });

  describe('getConfiguredDirectories', () => {
    it('should return array of configured directories', () => {
      const directories = detector.getConfiguredDirectories();
      
      expect(Array.isArray(directories)).toBe(true);
      expect(directories).toHaveLength(2);
      expect(directories).toContain('/Users/testuser/Projects/riversync');
      expect(directories).toContain('/Users/testuser/Projects/mula');
    });
  });

  describe('addMapping', () => {
    it('should add new directory mapping', () => {
      const newConfig: AzureDevOpsConfig = {
        organizationUrl: 'https://dev.azure.com/new-org',
        pat: 'new-pat',
        project: 'NewProject'
      };

      detector.addMapping('/Users/testuser/Projects/new-project', newConfig);
      
      const config = detector.detectConfiguration('/Users/testuser/Projects/new-project');
      expect(config).not.toBeNull();
      expect(config?.project).toBe('NewProject');
    });
  });

  describe('removeMapping', () => {
    it('should remove existing directory mapping', () => {
      const removed = detector.removeMapping('/Users/testuser/Projects/mula');
      
      expect(removed).toBe(true);
      
      const config = detector.detectConfiguration('/Users/testuser/Projects/mula');
      expect(config).toBeNull();
    });

    it('should return false when removing non-existent mapping', () => {
      const removed = detector.removeMapping('/Users/testuser/Projects/non-existent');
      
      expect(removed).toBe(false);
    });
  });

  describe('setDefaultConfig', () => {
    it('should use default config when no directory match found', () => {
      const defaultConfig: AzureDevOpsConfig = {
        organizationUrl: 'https://dev.azure.com/default',
        pat: 'default-pat',
        project: 'DefaultProject'
      };

      detector.setDefaultConfig(defaultConfig);
      
      const config = detector.detectConfiguration('/Users/testuser/Projects/unknown');
      expect(config).not.toBeNull();
      expect(config?.project).toBe('DefaultProject');
    });
  });
});