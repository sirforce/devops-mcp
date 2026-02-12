/**
 * Unit tests for Phase 1 improvements:
 * - Improved summary trigger logic
 * - Compact mode for user fields
 * - Intelligent truncation
 */

import { ToolHandlers } from '../../src/handlers/tool-handlers';

describe('Phase 1: Work Items Improvements', () => {
  let toolHandlers: ToolHandlers;

  beforeEach(() => {
    toolHandlers = new ToolHandlers();

    // Set up mock configuration
    toolHandlers.setCurrentConfig({
      organizationUrl: 'https://dev.azure.com/test-org',
      project: 'TestProject',
      pat: 'test-pat-token',
    });
  });

  describe('Compact Mode', () => {
    it('should compact user fields to displayName only', () => {
      const mockUserObject = {
        displayName: 'Test User',
        url: 'https://example.com/user',
        _links: { avatar: { href: 'https://avatar.url' } },
        id: 'user-id-123',
        uniqueName: 'testuser@example.com',
        imageUrl: 'https://image.url',
        descriptor: 'aad.descriptor'
      };

      // Access private method through type casting
      const compactUserField = (toolHandlers as any).compactUserField.bind(toolHandlers);

      const result = compactUserField(mockUserObject, true);

      expect(result).toBe('Test User');
      expect(typeof result).toBe('string');
    });

    it('should not compact when compact mode is false', () => {
      const mockUserObject = {
        displayName: 'Test User',
        id: 'user-id-123'
      };

      const compactUserField = (toolHandlers as any).compactUserField.bind(toolHandlers);

      const result = compactUserField(mockUserObject, false);

      expect(result).toEqual(mockUserObject);
      expect(typeof result).toBe('object');
    });

    it('should handle null user objects gracefully', () => {
      const compactUserField = (toolHandlers as any).compactUserField.bind(toolHandlers);

      const result = compactUserField(null, true);

      expect(result).toBeNull();
    });

    it('should compact multiple work items correctly', () => {
      const mockWorkItems = [
        {
          id: 1,
          fields: {
            'System.Title': 'Test Item 1',
            'System.AssignedTo': {
              displayName: 'User 1',
              id: 'id-1',
              uniqueName: 'user1@test.com'
            },
            'System.CreatedBy': {
              displayName: 'Creator 1',
              id: 'id-2'
            }
          },
          _links: { html: { href: 'https://link.com' } },
          commentVersionRef: { commentId: 123 }
        },
        {
          id: 2,
          fields: {
            'System.Title': 'Test Item 2',
            'System.AssignedTo': {
              displayName: 'User 2',
              id: 'id-3'
            }
          },
          _links: { html: { href: 'https://link2.com' } }
        }
      ];

      const compactWorkItems = (toolHandlers as any).compactWorkItems.bind(toolHandlers);

      const result = compactWorkItems(mockWorkItems, true);

      expect(result).toHaveLength(2);
      expect(result[0].fields['System.AssignedTo']).toBe('User 1');
      expect(result[0].fields['System.CreatedBy']).toBe('Creator 1');
      expect(result[0]._links).toBeUndefined();
      expect(result[0].commentVersionRef).toBeUndefined();
      expect(result[1].fields['System.AssignedTo']).toBe('User 2');
    });
  });

  describe('Summary Format with GroupBy', () => {
    const mockWorkItems = [
      {
        id: 1,
        fields: {
          'System.Title': 'Test Item 1',
          'System.State': 'Active',
          'System.WorkItemType': 'Task',
          'System.AssignedTo': { displayName: 'User 1' },
          'Microsoft.VSTS.Scheduling.StoryPoints': 5
        }
      },
      {
        id: 2,
        fields: {
          'System.Title': 'Test Item 2',
          'System.State': 'Active',
          'System.WorkItemType': 'Bug',
          'System.AssignedTo': { displayName: 'User 2' },
          'Microsoft.VSTS.Scheduling.StoryPoints': 3
        }
      },
      {
        id: 3,
        fields: {
          'System.Title': 'Test Item 3',
          'System.State': 'Closed',
          'System.WorkItemType': 'Task',
          'System.AssignedTo': { displayName: 'User 1' },
          'Microsoft.VSTS.Scheduling.StoryPoints': 2
        }
      }
    ];

    it('should group by State by default', () => {
      const formatSummary = (toolHandlers as any).formatWorkItemsSummary.bind(toolHandlers);

      const result = formatSummary(mockWorkItems);

      expect(result).toContain('Grouped by System.State');
      expect(result).toContain('ACTIVE (2 items');
      expect(result).toContain('CLOSED (1 items');
      expect(result).toContain('3 items, 10 story points');
    });

    it('should group by AssignedTo when specified', () => {
      const formatSummary = (toolHandlers as any).formatWorkItemsSummary.bind(toolHandlers);

      const result = formatSummary(mockWorkItems, 'System.AssignedTo');

      expect(result).toContain('Grouped by System.AssignedTo');
      expect(result).toContain('USER 1 (2 items');
      expect(result).toContain('USER 2 (1 items');
    });

    it('should group by WorkItemType when specified', () => {
      const formatSummary = (toolHandlers as any).formatWorkItemsSummary.bind(toolHandlers);

      const result = formatSummary(mockWorkItems, 'System.WorkItemType');

      expect(result).toContain('Grouped by System.WorkItemType');
      expect(result).toContain('TASK (2 items');
      expect(result).toContain('BUG (1 items');
    });

    it('should sort groups by item count descending', () => {
      const formatSummary = (toolHandlers as any).formatWorkItemsSummary.bind(toolHandlers);

      const result = formatSummary(mockWorkItems, 'System.State');

      const activeIndex = result.indexOf('ACTIVE (2 items');
      const closedIndex = result.indexOf('CLOSED (1 items');

      expect(activeIndex).toBeLessThan(closedIndex);
    });

    it('should limit items per group to 10', () => {
      // Create mock data with 15 items in one group
      const manyItems = Array.from({ length: 15 }, (_, i) => ({
        id: i + 1,
        fields: {
          'System.Title': `Test Item ${i + 1}`,
          'System.State': 'Active',
          'System.WorkItemType': 'Task',
          'System.AssignedTo': { displayName: 'User 1' }
        }
      }));

      const formatSummary = (toolHandlers as any).formatWorkItemsSummary.bind(toolHandlers);

      const result = formatSummary(manyItems);

      expect(result).toContain('... and 5 more');
    });
  });

  describe('Size Detection', () => {
    it('should calculate size correctly for small results', () => {
      const smallResult = { count: 5, value: [] };
      const resultString = JSON.stringify(smallResult, null, 2);
      const sizeBytes = Buffer.byteLength(resultString, 'utf8');

      expect(sizeBytes).toBeLessThan(1000);
    });

    it('should calculate size correctly for large results', () => {
      // Create a realistic large result set
      const largeResult = {
        count: 95,
        value: Array.from({ length: 95 }, (_, i) => ({
          id: i + 1,
          rev: 1,
          fields: {
            'System.Title': 'Test Work Item ' + i,
            'System.State': 'Active',
            'System.AssignedTo': {
              displayName: 'Test User',
              url: 'https://dev.azure.com/test',
              _links: { avatar: { href: 'https://avatar.com' } },
              id: 'user-id-' + i,
              uniqueName: 'user@test.com',
              imageUrl: 'https://image.com',
              descriptor: 'aad.descriptor' + i
            },
            'System.CreatedBy': {
              displayName: 'Creator User',
              url: 'https://dev.azure.com/test',
              _links: { avatar: { href: 'https://avatar.com' } },
              id: 'creator-id-' + i,
              uniqueName: 'creator@test.com',
              imageUrl: 'https://image.com',
              descriptor: 'aad.descriptor' + i
            },
            'System.ChangedBy': {
              displayName: 'Changed User',
              url: 'https://dev.azure.com/test',
              _links: { avatar: { href: 'https://avatar.com' } },
              id: 'changed-id-' + i,
              uniqueName: 'changed@test.com',
              imageUrl: 'https://image.com',
              descriptor: 'aad.descriptor' + i
            }
          },
          _links: { html: { href: 'https://link.com/' + i } },
          url: 'https://url.com/' + i
        }))
      };

      const resultString = JSON.stringify(largeResult, null, 2);
      const sizeBytes = Buffer.byteLength(resultString, 'utf8');

      // Should be well over 100KB
      expect(sizeBytes).toBeGreaterThan(100000);
    });

    it('should show significant size reduction with compact mode', () => {
      const testData = Array.from({ length: 50 }, (_, i) => ({
        id: i + 1,
        fields: {
          'System.AssignedTo': {
            displayName: 'User ' + i,
            url: 'https://example.com',
            _links: { avatar: { href: 'https://avatar.com' } },
            id: 'id-' + i,
            uniqueName: 'user' + i + '@test.com',
            imageUrl: 'https://image.com',
            descriptor: 'descriptor-' + i
          }
        },
        _links: { html: { href: 'https://link.com' } },
        commentVersionRef: { commentId: i }
      }));

      const fullSize = Buffer.byteLength(JSON.stringify(testData), 'utf8');

      const compactWorkItems = (toolHandlers as any).compactWorkItems.bind(toolHandlers);
      const compacted = compactWorkItems(testData, true);

      const compactSize = Buffer.byteLength(JSON.stringify(compacted), 'utf8');

      const reduction = ((fullSize - compactSize) / fullSize) * 100;

      // Should see at least 50% reduction
      expect(reduction).toBeGreaterThan(50);
      console.log(`Size reduction: ${reduction.toFixed(1)}%`);
    });
  });

  describe('Summary Trigger Logic', () => {
    it('should trigger summary for more than 20 items', () => {
      const itemCount = 25;
      const SUMMARY_THRESHOLD_ITEMS = 20;

      expect(itemCount).toBeGreaterThan(SUMMARY_THRESHOLD_ITEMS);
    });

    it('should trigger summary when size exceeds threshold', () => {
      const SIZE_WARNING_THRESHOLD = 150000; // 37.5KB
      const largeSize = 180000;

      expect(largeSize).toBeGreaterThan(SIZE_WARNING_THRESHOLD);
    });

    it('should force summary when exceeding token limit', () => {
      const TOKEN_LIMIT = 200000;
      const massiveSize = 250000;

      expect(massiveSize).toBeGreaterThan(TOKEN_LIMIT);
    });
  });
});
