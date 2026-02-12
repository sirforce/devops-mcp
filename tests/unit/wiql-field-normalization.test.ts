/**
 * Unit tests for WIQL field name normalization
 * Tests the auto-correction of common field name errors in WIQL queries
 */

import { ToolHandlers } from '../../src/handlers/tool-handlers';

describe('WIQL Field Name Normalization', () => {
  let toolHandlers: ToolHandlers;

  beforeEach(() => {
    toolHandlers = new ToolHandlers();
  });

  describe('Microsoft.VSTS date fields', () => {
    it('should normalize ClosedDate to Microsoft.VSTS.Common.ClosedDate', () => {
      const input = 'SELECT [System.Id], [ClosedDate] FROM WorkItems';
      const output = (toolHandlers as any).normalizeWiqlFieldNames(input);
      expect(output).toContain('[Microsoft.VSTS.Common.ClosedDate]');
      expect(output).not.toContain('[ClosedDate]');
    });

    it('should normalize ResolvedDate to Microsoft.VSTS.Common.ResolvedDate', () => {
      const input = 'SELECT [System.Id], [ResolvedDate] FROM WorkItems';
      const output = (toolHandlers as any).normalizeWiqlFieldNames(input);
      expect(output).toContain('[Microsoft.VSTS.Common.ResolvedDate]');
    });

    it('should normalize ActivatedDate to Microsoft.VSTS.Common.ActivatedDate', () => {
      const input = 'SELECT [System.Id], [ActivatedDate] FROM WorkItems';
      const output = (toolHandlers as any).normalizeWiqlFieldNames(input);
      expect(output).toContain('[Microsoft.VSTS.Common.ActivatedDate]');
    });

    it('should normalize StateChangeDate to Microsoft.VSTS.Common.StateChangeDate', () => {
      const input = 'SELECT [System.Id], [StateChangeDate] FROM WorkItems';
      const output = (toolHandlers as any).normalizeWiqlFieldNames(input);
      expect(output).toContain('[Microsoft.VSTS.Common.StateChangeDate]');
    });
  });

  describe('Microsoft.VSTS priority and severity fields', () => {
    it('should normalize Priority to Microsoft.VSTS.Common.Priority', () => {
      const input = 'SELECT [System.Id] FROM WorkItems WHERE [Priority] = 1';
      const output = (toolHandlers as any).normalizeWiqlFieldNames(input);
      expect(output).toContain('[Microsoft.VSTS.Common.Priority]');
      expect(output).not.toContain('[Priority]');
    });

    it('should normalize Severity to Microsoft.VSTS.Common.Severity', () => {
      const input = 'SELECT [System.Id] FROM WorkItems WHERE [Severity] = "3 - Medium"';
      const output = (toolHandlers as any).normalizeWiqlFieldNames(input);
      expect(output).toContain('[Microsoft.VSTS.Common.Severity]');
    });

    it('should normalize StackRank to Microsoft.VSTS.Common.StackRank', () => {
      const input = 'SELECT [System.Id], [StackRank] FROM WorkItems';
      const output = (toolHandlers as any).normalizeWiqlFieldNames(input);
      expect(output).toContain('[Microsoft.VSTS.Common.StackRank]');
    });
  });

  describe('Microsoft.VSTS scheduling fields', () => {
    it('should normalize StoryPoints to Microsoft.VSTS.Scheduling.StoryPoints', () => {
      const input = 'SELECT [System.Id], [StoryPoints] FROM WorkItems';
      const output = (toolHandlers as any).normalizeWiqlFieldNames(input);
      expect(output).toContain('[Microsoft.VSTS.Scheduling.StoryPoints]');
      expect(output).not.toContain('[StoryPoints]');
    });

    it('should normalize Effort to Microsoft.VSTS.Scheduling.Effort', () => {
      const input = 'SELECT [System.Id], [Effort] FROM WorkItems';
      const output = (toolHandlers as any).normalizeWiqlFieldNames(input);
      expect(output).toContain('[Microsoft.VSTS.Scheduling.Effort]');
    });

    it('should normalize RemainingWork to Microsoft.VSTS.Scheduling.RemainingWork', () => {
      const input = 'SELECT [System.Id], [RemainingWork] FROM WorkItems';
      const output = (toolHandlers as any).normalizeWiqlFieldNames(input);
      expect(output).toContain('[Microsoft.VSTS.Scheduling.RemainingWork]');
    });
  });

  describe('System field normalization', () => {
    it('should add System prefix to Title when missing', () => {
      const input = 'SELECT [Id], [Title] FROM WorkItems';
      const output = (toolHandlers as any).normalizeWiqlFieldNames(input);
      expect(output).toContain('[System.Title]');
      expect(output).not.toContain('[Title]');
    });

    it('should add System prefix to State when missing', () => {
      const input = 'SELECT [Id] FROM WorkItems WHERE [State] = "Active"';
      const output = (toolHandlers as any).normalizeWiqlFieldNames(input);
      expect(output).toContain('[System.State]');
    });

    it('should add System prefix to AssignedTo when missing', () => {
      const input = 'SELECT [Id], [AssignedTo] FROM WorkItems';
      const output = (toolHandlers as any).normalizeWiqlFieldNames(input);
      expect(output).toContain('[System.AssignedTo]');
    });

    it('should add System prefix to CreatedDate when missing', () => {
      const input = 'SELECT [Id], [CreatedDate] FROM WorkItems';
      const output = (toolHandlers as any).normalizeWiqlFieldNames(input);
      expect(output).toContain('[System.CreatedDate]');
    });

    it('should add System prefix to Tags when missing', () => {
      const input = 'SELECT [Id] FROM WorkItems WHERE [Tags] CONTAINS "urgent"';
      const output = (toolHandlers as any).normalizeWiqlFieldNames(input);
      expect(output).toContain('[System.Tags]');
    });
  });

  describe('Already correct field names', () => {
    it('should not modify already-correct System.* fields', () => {
      const input = 'SELECT [System.Id], [System.Title], [System.State] FROM WorkItems';
      const output = (toolHandlers as any).normalizeWiqlFieldNames(input);
      expect(output).toBe(input);
    });

    it('should not modify already-correct Microsoft.VSTS.* fields', () => {
      const input = 'SELECT [System.Id], [Microsoft.VSTS.Common.ClosedDate], [Microsoft.VSTS.Scheduling.StoryPoints] FROM WorkItems';
      const output = (toolHandlers as any).normalizeWiqlFieldNames(input);
      expect(output).toBe(input);
    });

    it('should preserve correct mixed field names', () => {
      const input = 'SELECT [System.Id], [System.Title], [Microsoft.VSTS.Common.Priority] FROM WorkItems';
      const output = (toolHandlers as any).normalizeWiqlFieldNames(input);
      expect(output).toBe(input);
    });
  });

  describe('Complex queries', () => {
    it('should normalize multiple fields in a complex query', () => {
      const input = `SELECT [Id], [Title], [State], [AssignedTo], [ClosedDate], [Priority], [StoryPoints]
                     FROM WorkItems
                     WHERE [Tags] CONTAINS 'urgent'
                     AND [CreatedDate] >= '2026-01-01'
                     ORDER BY [ChangedDate] DESC`;

      const output = (toolHandlers as any).normalizeWiqlFieldNames(input);

      // Check all normalizations occurred
      expect(output).toContain('[System.Title]');
      expect(output).toContain('[System.State]');
      expect(output).toContain('[System.AssignedTo]');
      expect(output).toContain('[System.Tags]');
      expect(output).toContain('[System.CreatedDate]');
      expect(output).toContain('[System.ChangedDate]');
      expect(output).toContain('[Microsoft.VSTS.Common.ClosedDate]');
      expect(output).toContain('[Microsoft.VSTS.Common.Priority]');
      expect(output).toContain('[Microsoft.VSTS.Scheduling.StoryPoints]');

      // Verify no un-prefixed field names remain
      expect(output).not.toMatch(/\[(?!System\.|Microsoft\.VSTS\.)(Title|State|AssignedTo|Tags|CreatedDate|ChangedDate|ClosedDate|Priority|StoryPoints)\]/);
    });

    it('should handle the exact query that caused the original error', () => {
      const input = `SELECT [System.Id], [System.Title], [System.WorkItemType], [System.State], [System.AssignedTo], [System.CreatedDate], [System.ClosedDate], [Microsoft.VSTS.Scheduling.StoryPoints], [System.IterationPath]
                     FROM WorkItems
                     WHERE [System.Tags] CONTAINS 'URGENT BUSINESS REQUEST'
                     AND [System.CreatedDate] >= '2026-01-01'
                     ORDER BY [System.CreatedDate] DESC`;

      const output = (toolHandlers as any).normalizeWiqlFieldNames(input);

      // The problematic [System.ClosedDate] should be corrected
      expect(output).toContain('[Microsoft.VSTS.Common.ClosedDate]');
      expect(output).not.toContain('[System.ClosedDate]');

      // Other already-correct fields should remain unchanged
      expect(output).toContain('[System.Id]');
      expect(output).toContain('[System.Title]');
      expect(output).toContain('[System.Tags]');
      expect(output).toContain('[Microsoft.VSTS.Scheduling.StoryPoints]');
    });
  });

  describe('Case insensitivity', () => {
    it('should normalize fields regardless of case', () => {
      const input = 'SELECT [Id], [title], [STATE], [assignedto], [closeddate] FROM WorkItems';
      const output = (toolHandlers as any).normalizeWiqlFieldNames(input);

      expect(output).toContain('[System.Title]');
      expect(output).toContain('[System.State]');
      expect(output).toContain('[System.AssignedTo]');
      expect(output).toContain('[Microsoft.VSTS.Common.ClosedDate]');
    });
  });

  describe('Edge cases', () => {
    it('should handle empty query', () => {
      const input = '';
      const output = (toolHandlers as any).normalizeWiqlFieldNames(input);
      expect(output).toBe('');
    });

    it('should handle query with no field references', () => {
      const input = 'SELECT * FROM WorkItems';
      const output = (toolHandlers as any).normalizeWiqlFieldNames(input);
      expect(output).toBe(input);
    });

    it('should not modify field names in string literals', () => {
      const input = `SELECT [System.Id] FROM WorkItems WHERE [System.Title] = 'Update Priority field'`;
      const output = (toolHandlers as any).normalizeWiqlFieldNames(input);
      // The word "Priority" in the string literal should not be touched
      expect(output).toBe(input);
    });
  });
});
