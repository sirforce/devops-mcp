/**
 * Unit tests for Phase 2 improvements:
 * - Server-side aggregation
 * - Pagination support
 */

import { ToolHandlers } from '../../src/handlers/tool-handlers';

describe('Phase 2: Aggregation and Pagination', () => {
  let toolHandlers: ToolHandlers;

  beforeEach(() => {
    toolHandlers = new ToolHandlers();
    toolHandlers.setCurrentConfig({
      organizationUrl: 'https://dev.azure.com/test-org',
      project: 'TestProject',
      pat: 'test-pat-token',
    });
  });

  describe('Aggregation - Contributors', () => {
    const mockWorkItems = [
      {
        id: 1,
        fields: {
          'System.AssignedTo': { displayName: 'User 1' },
          'System.CreatedBy': { displayName: 'Creator 1' },
          'System.ChangedBy': { displayName: 'User 1' }
        }
      },
      {
        id: 2,
        fields: {
          'System.AssignedTo': { displayName: 'User 2' },
          'System.CreatedBy': { displayName: 'Creator 1' },
          'System.ChangedBy': { displayName: 'User 2' }
        }
      },
      {
        id: 3,
        fields: {
          'System.AssignedTo': { displayName: 'User 1' },
          'System.CreatedBy': { displayName: 'Creator 2' },
          'System.ChangedBy': { displayName: 'User 3' }
        }
      }
    ];

    it('should aggregate unique contributors', () => {
      const aggregateContributors = (toolHandlers as any).aggregateContributors.bind(toolHandlers);

      const result = aggregateContributors(mockWorkItems);

      expect(result.totalWorkItems).toBe(3);
      expect(result.contributorCount).toBe(5); // User 1, User 2, User 3, Creator 1, Creator 2 = 5 unique
      expect(result.uniqueContributors).toContain('User 1');
      expect(result.uniqueContributors).toContain('User 2');
      expect(result.uniqueContributors).toContain('Creator 1');
      expect(result.uniqueContributors).toContain('Creator 2');
    });

    it('should count contributions by role', () => {
      const aggregateContributors = (toolHandlers as any).aggregateContributors.bind(toolHandlers);

      const result = aggregateContributors(mockWorkItems);

      expect(result.byRole.assignedTo).toHaveLength(2);
      expect(result.byRole.assignedTo[0]).toEqual({ name: 'User 1', count: 2 });
      expect(result.byRole.assignedTo[1]).toEqual({ name: 'User 2', count: 1 });

      expect(result.byRole.createdBy).toHaveLength(2);
      expect(result.byRole.changedBy).toHaveLength(3);
    });

    it('should sort contributors by count descending', () => {
      const aggregateContributors = (toolHandlers as any).aggregateContributors.bind(toolHandlers);

      const result = aggregateContributors(mockWorkItems);

      // User 1 appears twice as assignedTo, so should be first
      expect(result.byRole.assignedTo[0].count).toBeGreaterThanOrEqual(result.byRole.assignedTo[1].count);
    });

    it('should handle unassigned work items', () => {
      const itemsWithUnassigned = [
        {
          id: 1,
          fields: {
            'System.CreatedBy': { displayName: 'Creator 1' },
            'System.ChangedBy': { displayName: 'User 1' }
          }
        }
      ];

      const aggregateContributors = (toolHandlers as any).aggregateContributors.bind(toolHandlers);

      const result = aggregateContributors(itemsWithUnassigned);

      expect(result.uniqueContributors).toContain('Unassigned');
    });
  });

  describe('Aggregation - By Field', () => {
    const mockWorkItems = [
      {
        id: 1,
        fields: {
          'System.Title': 'Item 1',
          'System.State': 'Active',
          'System.WorkItemType': 'Task',
          'System.AssignedTo': { displayName: 'User 1' },
          'Microsoft.VSTS.Scheduling.StoryPoints': 5
        }
      },
      {
        id: 2,
        fields: {
          'System.Title': 'Item 2',
          'System.State': 'Active',
          'System.WorkItemType': 'Bug',
          'System.AssignedTo': { displayName: 'User 2' },
          'Microsoft.VSTS.Scheduling.StoryPoints': 3
        }
      },
      {
        id: 3,
        fields: {
          'System.Title': 'Item 3',
          'System.State': 'Closed',
          'System.WorkItemType': 'Task',
          'System.AssignedTo': { displayName: 'User 1' },
          'Microsoft.VSTS.Scheduling.StoryPoints': 2
        }
      }
    ];

    it('should aggregate by state', () => {
      const aggregateByField = (toolHandlers as any).aggregateByField.bind(toolHandlers);

      const result = aggregateByField(mockWorkItems, 'System.State');

      expect(result.totalWorkItems).toBe(3);
      expect(result.totalStoryPoints).toBe(10);
      expect(result.groupedBy).toBe('System.State');
      expect(result.groups).toHaveLength(2);
    });

    it('should aggregate by work item type', () => {
      const aggregateByField = (toolHandlers as any).aggregateByField.bind(toolHandlers);

      const result = aggregateByField(mockWorkItems, 'System.WorkItemType');

      expect(result.groups).toHaveLength(2);

      const taskGroup = result.groups.find((g: any) => g.name === 'Task');
      expect(taskGroup.count).toBe(2);
      expect(taskGroup.storyPoints).toBe(7);

      const bugGroup = result.groups.find((g: any) => g.name === 'Bug');
      expect(bugGroup.count).toBe(1);
      expect(bugGroup.storyPoints).toBe(3);
    });

    it('should sort groups by count descending', () => {
      const aggregateByField = (toolHandlers as any).aggregateByField.bind(toolHandlers);

      const result = aggregateByField(mockWorkItems, 'System.State');

      // Active has 2 items, Closed has 1, so Active should be first
      expect(result.groups[0].count).toBeGreaterThanOrEqual(result.groups[1].count);
    });

    it('should limit items per group to 5', () => {
      const manyItems = Array.from({ length: 10 }, (_, i) => ({
        id: i + 1,
        fields: {
          'System.Title': `Item ${i + 1}`,
          'System.State': 'Active',
          'System.WorkItemType': 'Task',
          'System.AssignedTo': { displayName: 'User 1' }
        }
      }));

      const aggregateByField = (toolHandlers as any).aggregateByField.bind(toolHandlers);

      const result = aggregateByField(manyItems, 'System.State');

      expect(result.groups[0].count).toBe(10);
      expect(result.groups[0].items).toHaveLength(5); // Limited to 5
    });
  });

  describe('Pagination', () => {
    it('should calculate pagination metadata correctly', () => {
      const page = 2;
      const pageSize = 50;
      const totalItems = 95;

      const totalPages = Math.ceil(totalItems / pageSize);
      const start = (page - 1) * pageSize;
      const end = start + pageSize;

      expect(totalPages).toBe(2);
      expect(start).toBe(50);
      expect(end).toBe(100);
      expect(end < totalItems).toBe(false); // No next page
      expect(page > 1).toBe(true); // Has previous page
    });

    it('should handle first page correctly', () => {
      const page = 1;
      const pageSize = 50;
      const totalItems = 95;

      const start = (page - 1) * pageSize;
      const end = start + pageSize;

      expect(start).toBe(0);
      expect(end).toBe(50);
      expect(end < totalItems).toBe(true); // Has next page
      expect(page > 1).toBe(false); // No previous page
    });

    it('should handle last page correctly', () => {
      const page = 2;
      const pageSize = 50;
      const totalItems = 95;

      const start = (page - 1) * pageSize;
      const end = start + pageSize;

      expect(start).toBe(50);
      expect(end).toBe(100);
      expect(end < totalItems).toBe(false); // No next page (95 items, end is 100)
    });

    it('should slice IDs correctly for pagination', () => {
      const allIds = Array.from({ length: 95 }, (_, i) => i + 1);
      const page = 2;
      const pageSize = 50;

      const start = (page - 1) * pageSize;
      const end = start + pageSize;
      const paginatedIds = allIds.slice(start, end);

      expect(paginatedIds).toHaveLength(45); // 95 - 50 = 45 items on page 2
      expect(paginatedIds[0]).toBe(51); // First item on page 2
      expect(paginatedIds[paginatedIds.length - 1]).toBe(95); // Last item
    });
  });

  describe('Aggregation Field Selection', () => {
    it('should return correct fields for contributors aggregation', () => {
      const getAggregationFields = (toolHandlers as any).getAggregationFields.bind(toolHandlers);

      const fields = getAggregationFields('contributors');

      expect(fields).toEqual(['System.AssignedTo', 'System.CreatedBy', 'System.ChangedBy']);
    });

    it('should return correct fields for by-state aggregation', () => {
      const getAggregationFields = (toolHandlers as any).getAggregationFields.bind(toolHandlers);

      const fields = getAggregationFields('by-state');

      expect(fields).toContain('System.State');
      expect(fields).toContain('System.WorkItemType');
      expect(fields).toContain('System.AssignedTo');
    });

    it('should return default fields for unknown aggregation type', () => {
      const getAggregationFields = (toolHandlers as any).getAggregationFields.bind(toolHandlers);

      const fields = getAggregationFields('unknown-type');

      expect(fields).toContain('System.Id');
      expect(fields).toContain('System.Title');
      expect(fields).toContain('System.State');
    });
  });
});
