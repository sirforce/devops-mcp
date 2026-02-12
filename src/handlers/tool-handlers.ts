/**
 * Tool Handlers for Azure DevOps Operations
 * Implements MCP tool handlers with dynamic environment switching
 * Enhanced with iteration path TF401347 error fix
 */

import { AzureDevOpsConfig } from '../types/index.js';
import * as https from 'https';
import * as url from 'url';

export class ToolHandlers {
  private currentConfig: AzureDevOpsConfig | null = null;

  /**
   * Common field name mappings for WIQL queries
   * Maps user-friendly or commonly misused field names to their correct Azure DevOps field references
   * This prevents TF51005 "field does not exist" errors by auto-correcting field names
   */
  private static readonly WIQL_FIELD_ALIASES: Record<string, string> = {
    // Date fields - commonly confused with System.* prefix
    'ClosedDate': 'Microsoft.VSTS.Common.ClosedDate',
    'ResolvedDate': 'Microsoft.VSTS.Common.ResolvedDate',
    'ActivatedDate': 'Microsoft.VSTS.Common.ActivatedDate',
    'StateChangeDate': 'Microsoft.VSTS.Common.StateChangeDate',

    // Priority and Severity fields
    'Priority': 'Microsoft.VSTS.Common.Priority',
    'Severity': 'Microsoft.VSTS.Common.Severity',
    'StackRank': 'Microsoft.VSTS.Common.StackRank',
    'ValueArea': 'Microsoft.VSTS.Common.ValueArea',

    // Scheduling fields
    'StoryPoints': 'Microsoft.VSTS.Scheduling.StoryPoints',
    'Effort': 'Microsoft.VSTS.Scheduling.Effort',
    'OriginalEstimate': 'Microsoft.VSTS.Scheduling.OriginalEstimate',
    'RemainingWork': 'Microsoft.VSTS.Scheduling.RemainingWork',
    'CompletedWork': 'Microsoft.VSTS.Scheduling.CompletedWork',

    // Bug-specific fields
    'ReproSteps': 'Microsoft.VSTS.TCM.ReproSteps',
    'SystemInfo': 'Microsoft.VSTS.TCM.SystemInfo',

    // Common System fields that users might forget to prefix
    'Title': 'System.Title',
    'State': 'System.State',
    'AssignedTo': 'System.AssignedTo',
    'CreatedDate': 'System.CreatedDate',
    'CreatedBy': 'System.CreatedBy',
    'ChangedDate': 'System.ChangedDate',
    'ChangedBy': 'System.ChangedBy',
    'WorkItemType': 'System.WorkItemType',
    'Tags': 'System.Tags',
    'IterationPath': 'System.IterationPath',
    'AreaPath': 'System.AreaPath',
    'Description': 'System.Description',
    'History': 'System.History',
    'TeamProject': 'System.TeamProject',
    'Parent': 'System.Parent',
    'BoardColumn': 'System.BoardColumn',
    'BoardColumnDone': 'System.BoardColumnDone'
  };

  /**
   * Set the current Azure DevOps configuration
   */
  setCurrentConfig(config: AzureDevOpsConfig): void {
    this.currentConfig = config;
  }

  /**
   * Sanitize a string to remove any occurrence of the current PAT token.
   * Used to prevent accidental PAT leakage in error messages, logs, or response bodies.
   * Replaces the PAT and its base64-encoded form with a redacted placeholder.
   */
  private sanitizePat(text: string): string {
    if (!this.currentConfig?.pat) {
      return text;
    }

    let sanitized = text;
    const pat = this.currentConfig.pat;

    // Remove the raw PAT value if it appears anywhere in the text
    if (sanitized.includes(pat)) {
      sanitized = sanitized.replace(new RegExp(pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '[PAT_REDACTED]');
    }

    // Also remove the base64-encoded form (as used in the Authorization header)
    const base64Pat = Buffer.from(`:${pat}`).toString('base64');
    if (sanitized.includes(base64Pat)) {
      sanitized = sanitized.replace(new RegExp(base64Pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '[PAT_BASE64_REDACTED]');
    }

    return sanitized;
  }

  /**
   * Escape a value for safe inclusion in a WIQL query string.
   * Prevents WIQL injection by escaping single quotes.
   */
  private escapeWiqlValue(value: string): string {
    // WIQL uses single-quoted string literals; escape embedded single quotes by doubling them
    return value.replace(/'/g, "''");
  }

  /**
   * Normalize WIQL field names by replacing common aliases with their correct Azure DevOps field references.
   * This prevents TF51005 "field does not exist" errors by auto-correcting commonly misused field names.
   *
   * Examples:
   * - [ClosedDate] → [Microsoft.VSTS.Common.ClosedDate]
   * - [System.ClosedDate] → [Microsoft.VSTS.Common.ClosedDate]
   * - [Priority] → [Microsoft.VSTS.Common.Priority]
   * - [Title] → [System.Title]
   *
   * @param wiql The WIQL query string to normalize
   * @returns The normalized WIQL query with corrected field names
   */
  private normalizeWiqlFieldNames(wiql: string): string {
    let normalized = wiql;
    let replacementCount = 0;

    // Process each alias mapping
    for (const [alias, fullName] of Object.entries(ToolHandlers.WIQL_FIELD_ALIASES)) {
      // Pattern 1: Match [alias] without any prefix
      const patternNoPrefix = new RegExp(`\\[(?!System\\.|Microsoft\\.VSTS\\.)${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]`, 'gi');

      if (patternNoPrefix.test(normalized)) {
        const beforeReplace = normalized;
        normalized = normalized.replace(patternNoPrefix, `[${fullName}]`);

        if (normalized !== beforeReplace) {
          replacementCount++;
          console.error(`[WIQL-NORMALIZE] Corrected field name: [${alias}] → [${fullName}]`);
        }
      }

      // Pattern 2: Match [System.alias] when the field should actually be in Microsoft.VSTS namespace
      // This handles cases like [System.ClosedDate] which should be [Microsoft.VSTS.Common.ClosedDate]
      if (fullName.startsWith('Microsoft.VSTS.')) {
        const patternSystemPrefix = new RegExp(`\\[System\\.${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]`, 'gi');

        if (patternSystemPrefix.test(normalized)) {
          const beforeReplace = normalized;
          normalized = normalized.replace(patternSystemPrefix, `[${fullName}]`);

          if (normalized !== beforeReplace) {
            replacementCount++;
            console.error(`[WIQL-NORMALIZE] Corrected incorrectly prefixed field: [System.${alias}] → [${fullName}]`);
          }
        }
      }
    }

    if (replacementCount > 0) {
      console.error(`[WIQL-NORMALIZE] Applied ${replacementCount} field name correction(s) to WIQL query`);
    }

    return normalized;
  }

  /**
   * Sanitize all text content in a tool response to prevent PAT leakage.
   * Applied as defense-in-depth to every response before it leaves the server.
   */
  private sanitizeResponse(response: any): any {
    if (!response || !response.content || !Array.isArray(response.content)) {
      return response;
    }

    return {
      ...response,
      content: response.content.map((item: any) => {
        if (item.type === 'text' && typeof item.text === 'string') {
          return { ...item, text: this.sanitizePat(item.text) };
        }
        return item;
      }),
    };
  }

  /**
   * Handle tool calls with current environment context
   */
  async handleToolCall(request: any): Promise<any> {
    if (!this.currentConfig) {
      throw new Error('No Azure DevOps configuration available');
    }

    const { name, arguments: args } = request.params;
    
    try {
      let result;
      switch (name) {
        case 'get-work-items':
          result = await this.getWorkItems(args || {});
          break;
        case 'get-work-item-aggregations':
          result = await this.getWorkItemAggregations(args || {});
          break;
        case 'create-work-item':
          result = await this.createWorkItem(args || {});
          break;
        case 'update-work-item':
          result = await this.updateWorkItem(args || {});
          break;
        case 'add-work-item-comment':
          result = await this.addWorkItemComment(args || {});
          break;
        case 'get-repositories':
          result = await this.getRepositories(args || {});
          break;
        case 'get-builds':
          result = await this.getBuilds(args || {});
          break;
        case 'get-pull-requests':
          result = await this.getPullRequests(args || {});
          break;
        case 'trigger-pipeline':
          result = await this.triggerPipeline(args || {});
          break;
        case 'get-pipeline-status':
          result = await this.getPipelineStatus(args || {});
          break;
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
      // Defense-in-depth: sanitize PAT from all successful responses
      return this.sanitizeResponse(result);
    } catch (error) {
      // Sanitize tool name to prevent log injection
      const sanitizedName = typeof name === 'string' ? name.replace(/[\r\n\t]/g, '_') : 'unknown';
      console.error(`Error in tool handler ${sanitizedName}:`, error instanceof Error ? error.message : 'Unknown error');
      return this.sanitizeResponse({
        content: [{
          type: 'text',
          text: `Error executing ${sanitizedName}: ${error instanceof Error ? this.sanitizePat(error.message) : 'Unknown error'}`,
        }],
        isError: true,
      });
    }
  }

  /**
   * Make authenticated API request to Azure DevOps
   * Security: Enforces HTTPS, validates hostname, and sanitizes PAT from error output.
   */
  private async makeApiRequest(endpoint: string, method: string = 'GET', body?: any): Promise<any> {
    if (!this.currentConfig) {
      throw new Error('No configuration available');
    }

    const { organizationUrl, pat, project } = this.currentConfig;
    const baseUrl = `${organizationUrl}/${project}/_apis`;
    const requestUrl = `${baseUrl}${endpoint}`;

    return new Promise((resolve, reject) => {
      const urlParts = new url.URL(requestUrl);

      // Security: Explicitly enforce HTTPS - never send PAT over plaintext
      if (urlParts.protocol !== 'https:') {
        reject(new Error(
          `Security error: Refusing to send authenticated request over non-HTTPS protocol '${urlParts.protocol}'. ` +
          `All Azure DevOps API requests must use HTTPS to protect PAT tokens.`
        ));
        return;
      }

      const postData = body ? JSON.stringify(body) : undefined;

      const options = {
        hostname: urlParts.hostname,
        port: urlParts.port || 443,
        path: urlParts.pathname + urlParts.search,
        method,
        headers: {
          'Authorization': `Basic ${Buffer.from(`:${pat}`).toString('base64')}`,
          'Content-Type': method === 'PATCH' && endpoint.includes('/wit/workitems/')
            ? 'application/json-patch+json'
            : 'application/json',
          'Accept': 'application/json',
          // For preview APIs, we need to properly handle the API version in the URL, not headers
          ...(postData && { 'Content-Length': Buffer.byteLength(postData) }),
        },
      };

      const req = https.request(options, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          try {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              const result = data ? JSON.parse(data) : {};
              resolve(result);
            } else {
              // Security: Sanitize the response body to ensure the PAT is never
              // leaked through error messages (e.g., if a proxy echoes headers back)
              const sanitizedData = this.sanitizePat(data);
              // Truncate excessively long error bodies to prevent log flooding
              const truncatedData = sanitizedData.length > 1000
                ? sanitizedData.substring(0, 1000) + '... [truncated]'
                : sanitizedData;
              reject(new Error(`HTTP ${res.statusCode}: ${truncatedData}`));
            }
          } catch (error) {
            reject(new Error(`Failed to parse response: ${error}`));
          }
        });
      });

      req.on('error', (error) => {
        // Security: Sanitize network error messages in case PAT leaks through proxy errors
        reject(new Error(`Request failed: ${this.sanitizePat(error.message)}`));
      });

      if (postData) {
        req.write(postData);
      }
      
      req.end();
    });
  }

  /**
   * Fetch work item details by IDs in batches to respect Azure DevOps API limits.
   * The /wit/workitems endpoint allows a maximum of 200 IDs per request.
   */
  private async fetchWorkItemsByIds(ids: number[], fieldsParam: string): Promise<any> {
    const BATCH_SIZE = 200;
    const allWorkItems: any[] = [];

    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const batchIds = ids.slice(i, i + BATCH_SIZE);
      const batchResult = await this.makeApiRequest(
        `/wit/workitems?ids=${batchIds.join(',')}${fieldsParam}&api-version=7.1`
      );
      if (batchResult.value && batchResult.value.length > 0) {
        allWorkItems.push(...batchResult.value);
      }
    }

    return { count: allWorkItems.length, value: allWorkItems };
  }

  /**
   * Strip any inline TOP N clause from a WIQL query and return the cleaned query + extracted limit.
   *
   * The WIQL REST API (/wit/wiql) does NOT support "TOP N" inside the query text.
   * Instead, the limit must be passed as the `$top` URL query parameter.
   * LLMs and users frequently include TOP in queries (SQL habit), so we strip it
   * and convert it to the proper URL parameter to avoid TF51006 errors.
   */
  private extractWiqlTop(wiql: string, defaultTop: number = 200): { query: string; top: number } {
    // Match "TOP <number>" anywhere in the query (case-insensitive)
    const topMatch = wiql.match(/\bTOP\s+(\d+)\b/i);
    if (topMatch) {
      const extractedTop = parseInt(topMatch[1], 10);
      // Remove the TOP clause from the query text
      const cleanedQuery = wiql.replace(/\bTOP\s+\d+\b/i, '').replace(/\s{2,}/g, ' ').trim();
      console.error(`[DEBUG] Stripped TOP ${extractedTop} from WIQL query text; will use $top URL parameter instead.`);
      return { query: cleanedQuery, top: extractedTop };
    }
    return { query: wiql, top: defaultTop };
  }

  /**
   * Compact user object to just essential fields
   * Reduces user object from 7+ properties to just displayName string
   */
  private compactUserField(userObject: any, compactMode: boolean): any {
    if (!compactMode || !userObject) {
      return userObject;
    }

    // Return only displayName for compact mode
    if (typeof userObject === 'object' && userObject.displayName) {
      return userObject.displayName;
    }

    return userObject;
  }

  /**
   * Apply compact mode to work item results
   * Significantly reduces response size for large result sets
   */
  private compactWorkItems(workItems: any[], compactFields: boolean): any[] {
    if (!compactFields) {
      return workItems;
    }

    return workItems.map(item => {
      const compacted = { ...item };

      // Compact user fields to just displayName strings
      const userFields = ['System.AssignedTo', 'System.CreatedBy', 'System.ChangedBy'];
      userFields.forEach(field => {
        if (compacted.fields[field]) {
          compacted.fields[field] = this.compactUserField(compacted.fields[field], true);
        }
      });

      // Remove unnecessary metadata that inflates response size
      delete compacted._links;
      delete compacted.commentVersionRef;
      // Keep url as it's useful for direct access

      return compacted;
    });
  }

  /**
   * Format work items as a summary for large result sets
   */
  private formatWorkItemsSummary(workItems: any[], groupBy?: string): string {
    groupBy = groupBy || 'System.State';

    const groups: { [key: string]: any[] } = {};
    let totalPoints = 0;

    // Group by specified field
    for (const item of workItems) {
      let groupKey: string;

      if (groupBy === 'System.AssignedTo') {
        groupKey = item.fields['System.AssignedTo']?.displayName || 'Unassigned';
      } else if (groupBy === 'System.WorkItemType') {
        groupKey = item.fields['System.WorkItemType'] || 'Unknown';
      } else {
        groupKey = item.fields[groupBy] || 'Unknown';
      }

      if (!groups[groupKey]) {
        groups[groupKey] = [];
      }

      const assigned = item.fields['System.AssignedTo']?.displayName || 'Unassigned';
      const points = item.fields['Microsoft.VSTS.Scheduling.StoryPoints'];
      const workType = item.fields['System.WorkItemType'];

      if (typeof points === 'number') {
        totalPoints += points;
      }

      groups[groupKey].push({
        id: item.id,
        title: item.fields['System.Title'],
        type: workType,
        state: item.fields['System.State'],
        assigned,
        points: points || 'N/A'
      });
    }

    // Build summary string
    let summary = '='.repeat(80) + '\n';
    summary += `Work Items Summary - Grouped by ${groupBy}\n`;
    summary += `(${workItems.length} items, ${totalPoints} story points)\n`;
    summary += '='.repeat(80) + '\n\n';

    // Sort groups by item count (descending)
    const sortedGroups = Object.entries(groups).sort((a, b) => b[1].length - a[1].length);

    for (const [groupName, items] of sortedGroups) {
      const groupPoints = items.reduce((sum, item) =>
        sum + (typeof item.points === 'number' ? item.points : 0), 0
      );

      summary += `\n${groupName.toUpperCase()} (${items.length} items, ${groupPoints} pts)\n`;
      summary += '-'.repeat(80) + '\n';

      // Limit to 10 items per group to keep summary manageable
      for (const item of items.slice(0, 10)) {
        const pointsStr = typeof item.points === 'number' ? `${item.points} pts` : 'N/A';
        const titleTrunc = item.title.length > 50 ? item.title.substring(0, 47) + '...' : item.title;
        summary += `  #${item.id.toString().padStart(5)} - ${item.type.padEnd(20)} - ${pointsStr.padEnd(8)} - ${titleTrunc}\n`;
        if (groupBy !== 'System.State') {
          summary += `          State: ${item.state}`;
        }
        if (groupBy !== 'System.AssignedTo') {
          summary += `  Assigned: ${item.assigned}\n`;
        } else {
          summary += '\n';
        }
      }

      if (items.length > 10) {
        summary += `  ... and ${items.length - 10} more\n`;
      }
    }

    return summary;
  }

  /**
   * Get aggregation fields based on aggregation type
   */
  private getAggregationFields(aggregationType: string): string[] {
    switch (aggregationType) {
      case 'contributors':
        return ['System.AssignedTo', 'System.CreatedBy', 'System.ChangedBy'];
      case 'by-state':
      case 'by-type':
      case 'by-assigned':
        return ['System.State', 'System.WorkItemType', 'System.AssignedTo', 'System.Title', 'Microsoft.VSTS.Scheduling.StoryPoints'];
      default:
        return ['System.Id', 'System.Title', 'System.State', 'System.AssignedTo'];
    }
  }

  /**
   * Aggregate contributors (AssignedTo, CreatedBy, ChangedBy)
   */
  private aggregateContributors(workItems: any[]): any {
    const contributors = new Set<string>();
    const byRole: { [role: string]: { [name: string]: number } } = {
      assignedTo: {},
      createdBy: {},
      changedBy: {}
    };

    for (const item of workItems) {
      // Assigned To
      const assigned = item.fields['System.AssignedTo']?.displayName || 'Unassigned';
      contributors.add(assigned);
      byRole.assignedTo[assigned] = (byRole.assignedTo[assigned] || 0) + 1;

      // Created By
      const created = item.fields['System.CreatedBy']?.displayName || 'Unknown';
      contributors.add(created);
      byRole.createdBy[created] = (byRole.createdBy[created] || 0) + 1;

      // Changed By
      const changed = item.fields['System.ChangedBy']?.displayName || 'Unknown';
      contributors.add(changed);
      byRole.changedBy[changed] = (byRole.changedBy[changed] || 0) + 1;
    }

    return {
      totalWorkItems: workItems.length,
      uniqueContributors: Array.from(contributors).sort(),
      contributorCount: contributors.size,
      byRole: {
        assignedTo: Object.entries(byRole.assignedTo)
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count),
        createdBy: Object.entries(byRole.createdBy)
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count),
        changedBy: Object.entries(byRole.changedBy)
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count)
      }
    };
  }

  /**
   * Aggregate by a specific field
   */
  private aggregateByField(workItems: any[], fieldName: string): any {
    const groups: { [key: string]: any[] } = {};
    let totalPoints = 0;

    for (const item of workItems) {
      let groupKey: string;

      if (fieldName === 'System.AssignedTo') {
        groupKey = item.fields['System.AssignedTo']?.displayName || 'Unassigned';
      } else {
        groupKey = item.fields[fieldName] || 'Unknown';
      }

      if (!groups[groupKey]) {
        groups[groupKey] = [];
      }

      const points = item.fields['Microsoft.VSTS.Scheduling.StoryPoints'];
      if (typeof points === 'number') {
        totalPoints += points;
      }

      groups[groupKey].push({
        id: item.id,
        title: item.fields['System.Title'],
        points: points || 0
      });
    }

    return {
      totalWorkItems: workItems.length,
      totalStoryPoints: totalPoints,
      groupedBy: fieldName,
      groups: Object.entries(groups)
        .map(([name, items]) => ({
          name,
          count: items.length,
          storyPoints: items.reduce((sum, item) => sum + (typeof item.points === 'number' ? item.points : 0), 0),
          items: items.slice(0, 5) // Include first 5 items as examples
        }))
        .sort((a, b) => b.count - a.count)
    };
  }

  /**
   * Get aggregated work item data (contributors, counts, statistics)
   */
  private async getWorkItemAggregations(args: any): Promise<any> {
    try {
      const aggregationType = args.type || 'contributors';

      if (!args.wiql) {
        throw new Error('WIQL query is required for aggregations');
      }

      // Execute WIQL query to get work items
      const { query: cleanWiql, top } = this.extractWiqlTop(args.wiql);

      // Normalize field names to prevent TF51005 errors (e.g., [ClosedDate] → [Microsoft.VSTS.Common.ClosedDate])
      const normalizedWiql = this.normalizeWiqlFieldNames(cleanWiql);

      const wiqlResult = await this.makeApiRequest(`/wit/wiql?api-version=7.1&$top=${top}`, 'POST', {
        query: normalizedWiql
      });

      if (!wiqlResult.workItems || wiqlResult.workItems.length === 0) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              message: 'No work items found',
              totalWorkItems: 0
            }, null, 2)
          }]
        };
      }

      const ids = wiqlResult.workItems.map((wi: any) => wi.id);
      const fields = this.getAggregationFields(aggregationType);
      const fieldsParam = `&fields=${encodeURIComponent(fields.join(','))}`;

      const result = await this.fetchWorkItemsByIds(ids, fieldsParam);

      // Perform server-side aggregation
      let aggregatedData;
      switch (aggregationType) {
        case 'contributors':
          aggregatedData = this.aggregateContributors(result.value);
          break;
        case 'by-state':
          aggregatedData = this.aggregateByField(result.value, 'System.State');
          break;
        case 'by-type':
          aggregatedData = this.aggregateByField(result.value, 'System.WorkItemType');
          break;
        case 'by-assigned':
          aggregatedData = this.aggregateByField(result.value, 'System.AssignedTo');
          break;
        default:
          throw new Error(`Unknown aggregation type: ${aggregationType}`);
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(aggregatedData, null, 2),
        }],
      };
    } catch (error) {
      throw new Error(`Failed to get work item aggregations: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get work items from Azure DevOps
   */
  private async getWorkItems(args: any): Promise<any> {
    try {
      let result;

      // Detect if wiql arg is actually a plain ID or comma-separated IDs (not a real WIQL query).
      // This prevents errors like TF51006 when a user passes "5" instead of a full WIQL statement.
      if (args.wiql && /^\s*\d+(\s*,\s*\d+)*\s*$/.test(args.wiql)) {
        const parsedIds = args.wiql.split(',').map((id: string) => parseInt(id.trim(), 10)).filter((id: number) => !isNaN(id));
        if (parsedIds.length > 0) {
          console.error(`[DEBUG] Detected plain ID(s) in wiql argument: [${parsedIds.join(', ')}]. Treating as ID lookup.`);
          // Merge with any explicit ids to avoid duplication
          args.ids = [...new Set([...(args.ids || []), ...parsedIds])];
          delete args.wiql;
        }
      }
      
      if (args.wiql) {
        // Strip any inline TOP N from the WIQL text and convert to $top URL param.
        // The WIQL REST API does NOT support TOP inside the query body — it causes TF51006 errors.
        // A default $top=200 is applied when no TOP is specified to prevent VS402337 (20,000 limit).
        const { query: cleanWiql, top } = this.extractWiqlTop(args.wiql);

        // Normalize field names to prevent TF51005 errors (e.g., [ClosedDate] → [Microsoft.VSTS.Common.ClosedDate])
        const normalizedWiql = this.normalizeWiqlFieldNames(cleanWiql);

        const wiqlResult = await this.makeApiRequest(`/wit/wiql?api-version=7.1&$top=${top}`, 'POST', {
          query: normalizedWiql
        });
        
        if (wiqlResult.workItems && wiqlResult.workItems.length > 0) {
          let ids = wiqlResult.workItems.map((wi: any) => wi.id);

          // Apply pagination if requested
          const page = args.page || 1;
          const pageSize = args.pageSize || (args.page ? 50 : undefined); // Only apply default pageSize if page is specified

          let paginationMetadata = null;
          if (page > 1 || pageSize) {
            const actualPageSize = pageSize || 50;
            const start = (page - 1) * actualPageSize;
            const end = start + actualPageSize;
            const paginatedIds = ids.slice(start, end);

            paginationMetadata = {
              page,
              pageSize: actualPageSize,
              totalItems: ids.length,
              totalPages: Math.ceil(ids.length / actualPageSize),
              hasNextPage: end < ids.length,
              hasPreviousPage: page > 1
            };

            ids = paginatedIds;
          }

          const fields = args.fields ? args.fields.join(',') : undefined;
          const fieldsParam = fields ? `&fields=${encodeURIComponent(fields)}` : '';

          // Fetch in batches of 200 to prevent VS403474 (page size exceeded)
          result = await this.fetchWorkItemsByIds(ids, fieldsParam);

          // Add pagination metadata if applicable
          if (paginationMetadata) {
            result._pagination = paginationMetadata;
          }
        } else {
          result = { value: [] };
        }
      } else if (args.ids && args.ids.length > 0) {
        // Get specific work items by ID – batch to respect 200-item limit
        const fields = args.fields ? args.fields.join(',') : undefined;
        const fieldsParam = fields ? `&fields=${encodeURIComponent(fields)}` : '';
        
        result = await this.fetchWorkItemsByIds(args.ids, fieldsParam);
      } else {
        // Default query for recent work items
        // Security: Escape project name to prevent WIQL injection via single quotes
        // Limit via $top URL parameter (NOT inline TOP — that causes TF51006 errors)
        const escapedProject = this.escapeWiqlValue(this.currentConfig!.project);
        const defaultWiql = `SELECT [System.Id], [System.Title], [System.State], [System.AssignedTo] FROM WorkItems WHERE [System.TeamProject] = '${escapedProject}' ORDER BY [System.ChangedDate] DESC`;
        
        const wiqlResult = await this.makeApiRequest('/wit/wiql?api-version=7.1&$top=50', 'POST', {
          query: defaultWiql
        });
        
        if (wiqlResult.workItems && wiqlResult.workItems.length > 0) {
          const ids = wiqlResult.workItems.map((wi: any) => wi.id);
          result = await this.fetchWorkItemsByIds(ids, '');
        } else {
          result = { value: [] };
        }
      }

      // Apply compact mode if requested (reduces user fields to displayName only)
      if (args.compact && result.value && result.value.length > 0) {
        result.value = this.compactWorkItems(result.value, true);
      }

      // Intelligent size-based result handling
      const resultString = JSON.stringify(result, null, 2);
      const sizeBytes = Buffer.byteLength(resultString, 'utf8');
      const TOKEN_LIMIT = 200000; // ~50KB of JSON in tokens
      const SIZE_WARNING_THRESHOLD = 150000; // 37.5KB
      const SUMMARY_THRESHOLD_ITEMS = 20;

      console.error(`[DEBUG] Result size: ${sizeBytes} bytes (${result.value?.length || 0} items)`);

      // Improved summary trigger logic - based on size AND item count
      const useSummary = args.format === 'summary' ||
                        (result.value && result.value.length > SUMMARY_THRESHOLD_ITEMS) ||
                        (sizeBytes > SIZE_WARNING_THRESHOLD);

      // Force summary if definitely over token limit (unless explicitly forced to JSON)
      if (sizeBytes > TOKEN_LIMIT && args.format !== 'json' && args.force !== true) {
        console.error(`[WARNING] Result exceeds token limit (${sizeBytes} bytes). Applying automatic summary format.`);

        return {
          content: [{
            type: 'text',
            text: this.formatWorkItemsSummary(result.value, args.groupBy),
          }],
          _metadata: {
            originalSize: sizeBytes,
            truncated: true,
            reason: 'exceeded-token-limit',
            itemCount: result.value?.length || 0,
            suggestions: [
              'Use compact: true to reduce user field sizes (70% reduction)',
              'Add format: "summary" for readable overview',
              'Specify only needed fields to reduce response size',
              'Use pagination (coming in Phase 2)'
            ]
          }
        };
      }

      // Use summary format if triggered
      if (useSummary && result.value && result.value.length > 0 && args.format !== 'json') {
        console.error(`[INFO] Using summary format for ${result.value.length} items (${sizeBytes} bytes)`);

        return {
          content: [{
            type: 'text',
            text: this.formatWorkItemsSummary(result.value, args.groupBy),
          }],
          _metadata: {
            format: 'summary',
            totalItems: result.value.length,
            estimatedFullSize: sizeBytes,
            hint: 'Use format: "json" with force: true for full JSON output'
          }
        };
      }

      // If approaching limit, add warning metadata
      if (sizeBytes > SIZE_WARNING_THRESHOLD) {
        console.error(`[WARNING] Large result detected (${sizeBytes} bytes)`);

        const suggestions = [];
        if (!args.compact) {
          suggestions.push('Add compact: true to reduce user field sizes (70% reduction)');
        }
        if (!args.format) {
          suggestions.push('Add format: "summary" for readable summary');
        }
        if (!args.fields && result.value?.[0]?.fields) {
          const availableFields = Object.keys(result.value[0].fields);
          suggestions.push(`Specify only needed fields (${availableFields.length} fields returned)`);
        }

        return {
          content: [{
            type: 'text',
            text: resultString,
          }],
          _metadata: {
            size: sizeBytes,
            warning: 'large-result',
            suggestions
          }
        };
      }

      // Normal size, return as-is
      return {
        content: [{
          type: 'text',
          text: resultString,
        }],
      };
    } catch (error) {
      throw new Error(`Failed to get work items: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Normalize iteration path format for Azure DevOps API compatibility
   * Format: ProjectName\SprintName (NOT ProjectName\Iteration\SprintName)
   * Azure DevOps REST API expects direct hierarchy without 'Iteration' component
   * Fixed TF401347 error by using correct \Iteration\ prefix format
   */
  private normalizeIterationPath(iterationPath: string): string {
    // Remove leading/trailing whitespace
    let normalized = iterationPath.trim();
    
    // Convert forward slashes to backslashes for consistency with Azure DevOps
    normalized = normalized.replace(/\//g, '\\');
    
    // Remove leading backslash if present
    if (normalized.startsWith('\\')) {
      normalized = normalized.substring(1);
    }
    
    // Handle different input scenarios
    const projectName = this.currentConfig!.project;
    
    // Case 1: Path starts with project name and has proper Iteration prefix
    if (normalized.startsWith(`${projectName}\\Iteration\\`)) {
      console.error(`[DEBUG] Path already in correct format with Iteration prefix: ${normalized}`);
      return normalized;
    }
    
    // Case 2: Path starts with project but missing Iteration component
    if (normalized.startsWith(`${projectName}\\`) && !normalized.includes('\\Iteration\\')) {
      // Insert Iteration component after project name
      const pathParts = normalized.split('\\');
      if (pathParts.length >= 2) {
        pathParts.splice(1, 0, 'Iteration');
        normalized = pathParts.join('\\');
        console.error(`[DEBUG] Added Iteration component to path: ${normalized}`);
        return normalized;
      }
    }
    
    // Case 3: Has Iteration prefix but missing project name (Iteration\SprintName)
    if (normalized.startsWith('Iteration\\')) {
      normalized = `${projectName}\\${normalized}`;
      console.error(`[DEBUG] Added project name prefix to Iteration path: ${normalized}`);
      return normalized;
    }
    
    // Case 4: Just the sprint name (SprintName or Sprint 3)
    if (!normalized.includes('\\')) {
      normalized = `${projectName}\\Iteration\\${normalized}`;
      console.error(`[DEBUG] Added full project and Iteration prefix to sprint: ${normalized}`);
      return normalized;
    }
    
    // Case 5: Starts with something else - ensure proper format
    if (!normalized.startsWith(projectName)) {
      // Check if it already has an Iteration component
      if (normalized.includes('\\Iteration\\')) {
        normalized = `${projectName}\\${normalized}`;
      } else {
        // Add both project name and Iteration component
        normalized = `${projectName}\\Iteration\\${normalized}`;
      }
      console.error(`[DEBUG] Added project name prefix with Iteration: ${normalized}`);
    }
    
    console.error(`[DEBUG] Normalized iteration path from '${iterationPath}' to '${normalized}'`);
    return normalized;
  }

  /**
   * Validate if an iteration path exists in the project using improved logic
   */
  private async validateIterationPath(iterationPath: string): Promise<string> {
    try {
      const normalizedPath = this.normalizeIterationPath(iterationPath);
      
      // Approach 1: Get project classification nodes with deep traversal
      try {
        const classificationNodes = await this.makeApiRequest('/wit/classificationnodes/iterations?api-version=7.1&$depth=10');
        
        const findInNodes = (node: any, targetPath: string): boolean => {
          // Check current node path
          if (node.path === targetPath) {
            console.error(`[DEBUG] Found exact path match: ${node.path}`);
            return true;
          }
          
          // Check alternative path formats (direct hierarchy without Iteration component)
          const alternativePaths = [
            node.path,
            node.name,
            `${this.currentConfig!.project}\\${node.name}`,
            node.structureType === 'iteration' ? node.path : null
          ].filter(Boolean);
          
          for (const altPath of alternativePaths) {
            if (altPath === targetPath || 
                altPath?.replace(/\\/g, '/') === targetPath.replace(/\\/g, '/')) {
              console.error(`[DEBUG] Found alternative path match: ${altPath} -> ${targetPath}`);
              return true;
            }
          }
          
          // Recursively check children
          if (node.children && node.children.length > 0) {
            for (const child of node.children) {
              if (findInNodes(child, targetPath)) {
                return true;
              }
            }
          }
          
          return false;
        };
        
        if (classificationNodes && findInNodes(classificationNodes, normalizedPath)) {
          console.error(`[DEBUG] Iteration path '${normalizedPath}' validated successfully`);
          return normalizedPath;
        }
        
        // Also try with original path format
        if (normalizedPath !== iterationPath && findInNodes(classificationNodes, iterationPath)) {
          console.error(`[DEBUG] Original iteration path '${iterationPath}' validated successfully`);
          return iterationPath;
        }
        
      } catch (classificationError) {
        console.error(`[DEBUG] Classification nodes query failed: ${classificationError instanceof Error ? classificationError.message : 'Unknown error'}`);
      }
      
      // Approach 2: Get team iterations (fallback)
      try {
        const iterations = await this.makeApiRequest('/work/teamsettings/iterations?api-version=7.1');
        
        const pathExists = iterations.value.some((iteration: any) => {
          const possiblePaths = [
            iteration.path,
            iteration.name,
            `${this.currentConfig!.project}\\${iteration.name}`,
            `${this.currentConfig!.project}/${iteration.name}`
          ].filter(Boolean);
          
          return possiblePaths.some(path => 
            path === normalizedPath || 
            path === iterationPath ||
            path?.replace(/\\/g, '/') === normalizedPath.replace(/\\/g, '/') ||
            path?.replace(/\\/g, '/') === iterationPath.replace(/\\/g, '/')
          );
        });
        
        if (pathExists) {
          console.error(`[DEBUG] Iteration path validated via team iterations`);
          return normalizedPath;
        }
      } catch (teamError) {
        console.error(`[DEBUG] Team iterations query failed: ${teamError instanceof Error ? teamError.message : 'Unknown error'}`);
      }
      
      // If both validation attempts failed to find the path, it doesn't exist
      console.error(`[DEBUG] Could not validate iteration path '${iterationPath}', normalized format '${normalizedPath}' does not exist`);
      console.error(`[DEBUG] SUGGESTION: Ensure the iteration '${normalizedPath}' exists in Azure DevOps project settings`);
      console.error(`[DEBUG] Expected format: ProjectName\\SprintName (e.g., '${this.currentConfig!.project}\\Sprint 1')`);
      throw new Error(`Iteration path '${iterationPath}' does not exist in project '${this.currentConfig!.project}'`);
      
    } catch (error) {
      // If there was an error that's not related to path validation (e.g., auth, network),
      // check if it's our custom "doesn't exist" error, if so re-throw it
      if (error instanceof Error && error.message.includes('does not exist in project')) {
        throw error;
      }
      
      // For other errors (network, auth, etc.), return normalized path with warning
      const normalizedPath = this.normalizeIterationPath(iterationPath);
      console.error(`[DEBUG] Validation error for path '${iterationPath}': ${error instanceof Error ? error.message : 'Unknown error'}`);
      console.error(`[DEBUG] Using normalized path due to validation service unavailability`);
      return normalizedPath;
    }
  }

  /**
   * Update work item iteration path post-creation
   */
  private async updateWorkItemIterationPath(workItemId: number, iterationPath: string): Promise<void> {
    const operations = [{
      op: 'replace',
      path: '/fields/System.IterationPath',
      value: iterationPath
    }];

    await this.makeApiRequest(
      `/wit/workitems/${workItemId}?api-version=7.1`,
      'PATCH',
      operations
    );
  }

  /**
   * Validate work item state for the given work item type
   * Prevents invalid state errors by checking supported states
   */
  private async validateWorkItemState(workItemType: string, state: string): Promise<string> {
    try {
      // Get work item type definition to check valid states
      const typeDefinition = await this.makeApiRequest(
        `/wit/workitemtypes/${encodeURIComponent(workItemType)}?api-version=7.1`
      );

      // Extract valid states from the work item type definition
      const validStates = typeDefinition.states?.map((s: any) => s.name) || [];
      
      if (validStates.length > 0 && !validStates.includes(state)) {
        console.error(`[DEBUG] Invalid state '${state}' for work item type '${workItemType}'. Valid states: [${validStates.join(', ')}]`);
        
        // Common state mappings for fallback
        const stateMappings: { [key: string]: { [key: string]: string } } = {
          'Bug': {
            'Removed': 'Resolved',
            'removed': 'Resolved'
          },
          'Task': {
            'Removed': 'Done',
            'removed': 'Done'
          },
          'User Story': {
            'Removed': 'Resolved',
            'removed': 'Resolved'
          }
        };

        const fallbackState = stateMappings[workItemType]?.[state] || validStates[0] || 'Active';
        console.error(`[DEBUG] Using fallback state '${fallbackState}' instead of '${state}' for work item type '${workItemType}'`);
        return fallbackState;
      }

      console.error(`[DEBUG] State '${state}' is valid for work item type '${workItemType}'`);
      return state;
    } catch (error) {
      // If validation fails, return the original state and let Azure DevOps handle it
      console.error(`[DEBUG] Could not validate state '${state}' for work item type '${workItemType}': ${error instanceof Error ? error.message : 'Unknown error'}`);
      console.error(`[DEBUG] Proceeding with original state - Azure DevOps will validate`);
      return state;
    }
  }

  /**
   * Create a new work item in Azure DevOps with enhanced iteration path handling
   */
  private async createWorkItem(args: any): Promise<any> {
    if (!args.type || !args.title) {
      throw new Error('Work item type and title are required');
    }

    try {
      const operations = [
        {
          op: 'add',
          path: '/fields/System.Title',
          value: args.title
        }
      ];

      if (args.description) {
        operations.push({
          op: 'add',
          path: '/fields/System.Description',
          value: args.description
        });
      }

      if (args.assignedTo) {
        operations.push({
          op: 'add',
          path: '/fields/System.AssignedTo',
          value: args.assignedTo
        });
      }

      if (args.tags) {
        operations.push({
          op: 'add',
          path: '/fields/System.Tags',
          value: args.tags
        });
      }

      // Support parent relationship during creation using relations API
      if (args.parent) {
        // Validate parent ID is a number
        const parentId = parseInt(args.parent, 10);
        if (isNaN(parentId) || parentId <= 0) {
          throw new Error(`Invalid parent work item ID: ${args.parent}. Must be a positive integer.`);
        }
        
        const parentUrl = `${this.currentConfig!.organizationUrl}/${this.currentConfig!.project}/_apis/wit/workItems/${parentId}`;
        console.error(`[DEBUG] Setting parent relationship to work item ${parentId} using URL: ${parentUrl}`);
        
        operations.push({
          op: 'add',
          path: '/relations/-',
          value: {
            rel: 'System.LinkTypes.Hierarchy-Reverse',
            url: parentUrl,
            attributes: {
              comment: `Parent relationship set via MCP create-work-item command`
            }
          }
        });
      }

      // Enhanced iteration path handling with normalization and validation
      let iterationPathHandled = false;
      let iterationPathError = null;
      let finalIterationPath = null;

      if (args.iterationPath) {
        try {
          // Validate and normalize the iteration path
          finalIterationPath = await this.validateIterationPath(args.iterationPath);
          
          // Add normalized path to the creation operations
          operations.push({
            op: 'add',
            path: '/fields/System.IterationPath',
            value: finalIterationPath
          });
          iterationPathHandled = true;
          console.error(`[DEBUG] Iteration path normalized to '${finalIterationPath}' and will be set during creation`);
        } catch (validationError) {
          iterationPathError = validationError;
          finalIterationPath = this.normalizeIterationPath(args.iterationPath);
          console.error(`[DEBUG] Iteration path validation failed: ${validationError instanceof Error ? validationError.message : 'Unknown error'}`);
          console.error(`[DEBUG] Will attempt to set normalized path '${finalIterationPath}' after work item creation`);
        }
      }

      // Support state during creation with validation
      if (args.state) {
        // Validate state for work item type to prevent TF401347-like errors
        const validatedState = await this.validateWorkItemState(args.type, args.state);
        operations.push({
          op: 'add',
          path: '/fields/System.State',
          value: validatedState
        });
      }

      // Handle generic field creation with intelligent field name resolution
      if (args.fields && typeof args.fields === 'object') {
        Object.entries(args.fields).forEach(([fieldName, fieldValue]) => {
          // CRITICAL FIX: Implement proper field name resolution as specified in GitHub issue #53
          let normalizedFieldName = fieldName;
          
          // CRITICAL: Microsoft.VSTS.* fields must NEVER be prefixed with System.
          // Azure DevOps field categories:
          // - System fields: Always prefixed with "System." (e.g., System.Title, System.State)
          // - Microsoft fields: Never prefixed, use full name (e.g., Microsoft.VSTS.Common.Priority)
          // - Custom fields: May have organization-specific prefixes
          
          // Apply System. prefix ONLY to fields that don't already have System. or Microsoft. prefixes
          if (!fieldName.startsWith('System.') && !fieldName.startsWith('Microsoft.')) {
            // Only add System. prefix for known system fields without namespaces
            const knownSystemFields = ['Title', 'Description', 'State', 'AssignedTo', 'Tags', 'IterationPath', 'AreaPath'];
            if (knownSystemFields.includes(fieldName)) {
              normalizedFieldName = `System.${fieldName}`;
            }
            // All other fields (including BusinessValue, Priority, Effort) remain unchanged
            // This preserves custom fields and Microsoft.VSTS.* fields correctly
          }
          // System.* and Microsoft.* fields are preserved exactly as-is

          console.error(`[DEBUG] Field resolution: "${fieldName}" → "${normalizedFieldName}"`);
          
          operations.push({
            op: 'add',
            path: `/fields/${normalizedFieldName}`,
            value: fieldValue
          });
        });
      }

      // Debug logging to validate the endpoint construction
      const endpoint = `/wit/workitems/$${args.type}?api-version=7.1`;
      console.error(`[DEBUG] Creating work item with endpoint: ${endpoint}`);
      console.error(`[DEBUG] Full URL will be: ${this.currentConfig!.organizationUrl}/${this.currentConfig!.project}/_apis${endpoint}`);
      
      // Create the work item
      const result = await this.makeApiRequest(
        endpoint,
        'PATCH',
        operations
      );

      // Handle iteration path post-creation if it wasn't set during creation
      if (args.iterationPath && !iterationPathHandled && finalIterationPath) {
        try {
          console.error(`[DEBUG] Attempting to set normalized iteration path '${finalIterationPath}' post-creation for work item ${result.id}`);
          await this.updateWorkItemIterationPath(result.id, finalIterationPath);
          
          // Refresh the work item to get updated fields
          const updatedResult = await this.makeApiRequest(`/wit/workitems/${result.id}?api-version=7.1`);
          Object.assign(result, updatedResult);
          
          console.error(`[DEBUG] Successfully set iteration path post-creation`);
        } catch (postCreationError) {
          console.error(`[WARNING] Failed to set iteration path post-creation: ${postCreationError instanceof Error ? postCreationError.message : 'Unknown error'}`);
          // Don't fail the entire operation, just log the warning
        }
      }

      // Extract parent information from relations
      let parentInfo = null;
      if (result.relations && result.relations.length > 0) {
        const parentRelation = result.relations.find((rel: any) =>
          rel.rel === 'System.LinkTypes.Hierarchy-Reverse'
        );
        if (parentRelation) {
          // Extract parent ID from URL (e.g., .../workItems/1562 -> 1562)
          const match = parentRelation.url.match(/workItems\/(\d+)$/);
          parentInfo = {
            id: match ? parseInt(match[1], 10) : null,
            url: parentRelation.url,
            comment: parentRelation.attributes?.comment
          };
        }
      }

      // Prepare response with enhanced error reporting
      const response: any = {
        success: true,
        workItem: {
          id: result.id,
          title: result.fields['System.Title'],
          type: result.fields['System.WorkItemType'],
          state: result.fields['System.State'],
          parent: result.fields['System.Parent'] || parentInfo?.id || null,
          parentRelation: parentInfo,
          iterationPath: result.fields['System.IterationPath'],
          assignedTo: result.fields['System.AssignedTo']?.displayName || result.fields['System.AssignedTo'],
          url: result._links.html.href,
          relations: result.relations?.length || 0
        },
        message: args.parent ? `Work item created with parent relationship to work item ${args.parent}` : 'Work item created successfully'
      };

      // Add iteration path handling details to response
      if (args.iterationPath) {
        response.iterationPathHandling = {
          requested: args.iterationPath,
          normalized: finalIterationPath,
          setDuringCreation: iterationPathHandled,
          finalValue: result.fields['System.IterationPath']
        };
        
        if (iterationPathError) {
          response.iterationPathHandling.validationError = iterationPathError instanceof Error ? iterationPathError.message : 'Unknown validation error';
        }
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(response, null, 2),
        }],
      };
    } catch (error) {
      throw new Error(`Failed to create work item: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Update an existing work item in Azure DevOps
   */
  private async updateWorkItem(args: any): Promise<any> {
    if (!args.id) {
      throw new Error('Work item ID is required');
    }

    if (!args.fields && !args.parent && !args.iterationPath && !args.state && !args.assignedTo && !args.title && !args.description && !args.tags) {
      throw new Error('At least one field to update must be provided');
    }

    try {
      const operations = [];

      // Handle individual field updates
      if (args.title) {
        operations.push({
          op: 'replace',
          path: '/fields/System.Title',
          value: args.title
        });
      }

      if (args.description) {
        operations.push({
          op: 'replace',
          path: '/fields/System.Description',
          value: args.description
        });
      }

      if (args.state) {
        // Get current work item to determine its type for state validation
        let workItemType = 'Task'; // Default fallback
        try {
          const currentWorkItem = await this.makeApiRequest(`/wit/workitems/${args.id}?api-version=7.1`);
          workItemType = currentWorkItem.fields['System.WorkItemType'] || 'Task';
        } catch (error) {
          console.error(`[DEBUG] Could not fetch work item type for validation, using default: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
        
        // Validate state for work item type to prevent invalid state errors
        const validatedState = await this.validateWorkItemState(workItemType, args.state);
        operations.push({
          op: 'replace',
          path: '/fields/System.State',
          value: validatedState
        });
      }

      if (args.assignedTo) {
        operations.push({
          op: 'replace',
          path: '/fields/System.AssignedTo',
          value: args.assignedTo
        });
      }

      if (args.tags) {
        operations.push({
          op: 'replace',
          path: '/fields/System.Tags',
          value: args.tags
        });
      }

      // Handle parent relationship using relations API
      if (args.parent) {
        // Validate parent ID is a number
        const parentId = parseInt(args.parent, 10);
        if (isNaN(parentId) || parentId <= 0) {
          throw new Error(`Invalid parent work item ID: ${args.parent}. Must be a positive integer.`);
        }
        
        const parentUrl = `${this.currentConfig!.organizationUrl}/${this.currentConfig!.project}/_apis/wit/workItems/${parentId}`;
        console.error(`[DEBUG] Setting parent relationship to work item ${parentId} using URL: ${parentUrl}`);
        
        operations.push({
          op: 'add',
          path: '/relations/-',
          value: {
            rel: 'System.LinkTypes.Hierarchy-Reverse',
            url: parentUrl,
            attributes: {
              comment: `Parent relationship updated via MCP update-work-item command`
            }
          }
        });
      }

      // Handle iteration path assignment with normalization (System.IterationPath)
      if (args.iterationPath) {
        const normalizedIterationPath = this.normalizeIterationPath(args.iterationPath);
        operations.push({
          op: 'replace',
          path: '/fields/System.IterationPath',
          value: normalizedIterationPath
        });
        console.error(`[DEBUG] Iteration path normalized from '${args.iterationPath}' to '${normalizedIterationPath}' for update`);
      }

      // Handle generic field updates with intelligent field name resolution
      if (args.fields && typeof args.fields === 'object') {
        Object.entries(args.fields).forEach(([fieldName, fieldValue]) => {
          // CRITICAL FIX: Implement proper field name resolution as specified in GitHub issue #53
          let normalizedFieldName = fieldName;
          
          // CRITICAL: Microsoft.VSTS.* fields must NEVER be prefixed with System.
          // Azure DevOps field categories:
          // - System fields: Always prefixed with "System." (e.g., System.Title, System.State)
          // - Microsoft fields: Never prefixed, use full name (e.g., Microsoft.VSTS.Common.Priority)
          // - Custom fields: May have organization-specific prefixes
          
          // Apply System. prefix ONLY to fields that don't already have System. or Microsoft. prefixes
          if (!fieldName.startsWith('System.') && !fieldName.startsWith('Microsoft.')) {
            // Only add System. prefix for known system fields without namespaces
            const knownSystemFields = ['Title', 'Description', 'State', 'AssignedTo', 'Tags', 'IterationPath', 'AreaPath'];
            if (knownSystemFields.includes(fieldName)) {
              normalizedFieldName = `System.${fieldName}`;
            }
            // All other fields (including BusinessValue, Priority, Effort) remain unchanged
            // This preserves custom fields and Microsoft.VSTS.* fields correctly
          }
          // System.* and Microsoft.* fields are preserved exactly as-is

          console.error(`[DEBUG] Field resolution: "${fieldName}" → "${normalizedFieldName}"`);
          
          operations.push({
            op: 'replace',
            path: `/fields/${normalizedFieldName}`,
            value: fieldValue
          });
        });
      }

      if (operations.length === 0) {
        throw new Error('No valid update operations specified');
      }

      // Debug logging to validate the endpoint construction
      const endpoint = `/wit/workitems/${args.id}?api-version=7.1`;
      console.error(`[DEBUG] Updating work item ${args.id} with endpoint: ${endpoint}`);
      console.error(`[DEBUG] Operations:`, JSON.stringify(operations, null, 2));
      
      const result = await this.makeApiRequest(
        endpoint,
        'PATCH',
        operations
      );

      // Extract parent information from relations
      let parentInfo = null;
      if (result.relations && result.relations.length > 0) {
        const parentRelation = result.relations.find((rel: any) =>
          rel.rel === 'System.LinkTypes.Hierarchy-Reverse'
        );
        if (parentRelation) {
          // Extract parent ID from URL (e.g., .../workItems/1562 -> 1562)
          const match = parentRelation.url.match(/workItems\/(\d+)$/);
          parentInfo = {
            id: match ? parseInt(match[1], 10) : null,
            url: parentRelation.url,
            comment: parentRelation.attributes?.comment
          };
        }
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            workItem: {
              id: result.id,
              title: result.fields['System.Title'],
              type: result.fields['System.WorkItemType'],
              state: result.fields['System.State'],
              parent: result.fields['System.Parent'] || parentInfo?.id || null,
              parentRelation: parentInfo,
              iterationPath: result.fields['System.IterationPath'],
              assignedTo: result.fields['System.AssignedTo']?.displayName || result.fields['System.AssignedTo'],
              url: result._links.html.href,
              relations: result.relations?.length || 0
            },
            operations: operations.length,
            message: args.parent ? `Work item updated with parent relationship to work item ${args.parent}` : `Successfully updated work item ${args.id}`
          }, null, 2),
        }],
      };
    } catch (error) {
      throw new Error(`Failed to update work item: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Add a comment to an existing work item in Azure DevOps
   * Fixed API version compatibility issue - using 6.0 for comments
   */
  private async addWorkItemComment(args: any): Promise<any> {
    if (!args.id) {
      throw new Error('Work item ID is required');
    }

    if (!args.comment) {
      throw new Error('Comment text is required');
    }

    try {
      const commentData = {
        text: args.comment
      };

      // Use API version 6.0-preview.4 for comments - required for work item comments endpoint
      const endpoint = `/wit/workitems/${args.id}/comments?api-version=6.0-preview.4`;
      console.error(`[DEBUG] Adding comment to work item ${args.id} with endpoint: ${endpoint}`);
      
      const result = await this.makeApiRequest(
        endpoint,
        'POST',
        commentData
      );

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            comment: {
              id: result.id,
              workItemId: args.id,
              text: result.text,
              createdBy: result.createdBy?.displayName || result.createdBy,
              createdDate: result.createdDate,
              url: result.url
            },
            message: `Successfully added comment to work item ${args.id}`
          }, null, 2),
        }],
      };
    } catch (error) {
      // Provide specific guidance for API version issues
      if (error instanceof Error && error.message.includes('preview')) {
        throw new Error(`Failed to add work item comment - API version issue: ${error.message}. Try using a different API version.`);
      }
      throw new Error(`Failed to add work item comment: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get repositories from Azure DevOps project
   */
  private async getRepositories(args: any): Promise<any> {
    try {
      const result = await this.makeApiRequest('/git/repositories?api-version=7.1');

      const repositories = result.value.map((repo: any) => ({
        id: repo.id,
        name: repo.name,
        url: repo.webUrl,
        defaultBranch: repo.defaultBranch,
        size: repo.size,
        ...(args.includeLinks && { links: repo._links })
      }));

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            count: repositories.length,
            repositories
          }, null, 2),
        }],
      };
    } catch (error) {
      throw new Error(`Failed to get repositories: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get build definitions and recent builds
   */
  private async getBuilds(args: any): Promise<any> {
    try {
      let endpoint = '/build/builds?api-version=7.1';
      
      const params = [];
      if (args.definitionIds && args.definitionIds.length > 0) {
        params.push(`definitions=${args.definitionIds.join(',')}`);
      }
      if (args.top) {
        params.push(`$top=${args.top}`);
      } else {
        params.push('$top=10'); // Default to 10 builds
      }
      
      if (params.length > 0) {
        endpoint += '&' + params.join('&');
      }

      const result = await this.makeApiRequest(endpoint);

      const builds = result.value.map((build: any) => ({
        id: build.id,
        buildNumber: build.buildNumber,
        status: build.status,
        result: build.result,
        definition: {
          id: build.definition.id,
          name: build.definition.name
        },
        startTime: build.startTime,
        finishTime: build.finishTime,
        url: build._links.web.href
      }));

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            count: builds.length,
            builds
          }, null, 2),
        }],
      };
    } catch (error) {
      throw new Error(`Failed to get builds: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get pull requests from Azure DevOps repositories
   */
  private async getPullRequests(args: any): Promise<any> {
    try {
      let endpoint = '/git/pullrequests?api-version=7.1';
      
      const params = [];
      
      // Status filter (default to active)
      const status = args.status || 'active';
      if (status !== 'all') {
        params.push(`searchCriteria.status=${status}`);
      }
      
      // Creator filter
      if (args.createdBy) {
        params.push(`searchCriteria.creatorId=${encodeURIComponent(args.createdBy)}`);
      }
      
      // Repository filter
      if (args.repositoryId) {
        params.push(`searchCriteria.repositoryId=${encodeURIComponent(args.repositoryId)}`);
      }
      
      // Top (limit) parameter
      const top = args.top || 25;
      params.push(`$top=${top}`);
      
      if (params.length > 0) {
        endpoint += '&' + params.join('&');
      }

      const result = await this.makeApiRequest(endpoint);

      const pullRequests = result.value.map((pr: any) => ({
        id: pr.pullRequestId,
        title: pr.title,
        description: pr.description,
        status: pr.status,
        createdBy: {
          displayName: pr.createdBy.displayName,
          uniqueName: pr.createdBy.uniqueName
        },
        creationDate: pr.creationDate,
        repository: {
          id: pr.repository.id,
          name: pr.repository.name
        },
        sourceRefName: pr.sourceRefName,
        targetRefName: pr.targetRefName,
        url: pr._links?.web?.href || `${this.currentConfig!.organizationUrl}/${this.currentConfig!.project}/_git/${pr.repository.name}/pullrequest/${pr.pullRequestId}`,
        isDraft: pr.isDraft || false,
        mergeStatus: pr.mergeStatus
      }));

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            count: pullRequests.length,
            status: status,
            pullRequests
          }, null, 2),
        }],
      };
    } catch (error) {
      throw new Error(`Failed to get pull requests: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Trigger a build pipeline in Azure DevOps
   */
  private async triggerPipeline(args: any): Promise<any> {
    try {
      let definitionId = args.definitionId;
      
      // If definition name is provided instead of ID, look up the ID
      if (!definitionId && args.definitionName) {
        const definitions = await this.makeApiRequest('/build/definitions?api-version=7.1');
        const definition = definitions.value.find((def: any) => 
          def.name.toLowerCase() === args.definitionName.toLowerCase()
        );
        
        if (!definition) {
          throw new Error(`Build definition '${args.definitionName}' not found`);
        }
        
        definitionId = definition.id;
      }
      
      if (!definitionId) {
        throw new Error('Either definitionId or definitionName must be provided');
      }

      // Prepare the build request
      const buildRequest: any = {
        definition: {
          id: definitionId
        }
      };

      // Add source branch if specified
      if (args.sourceBranch) {
        buildRequest.sourceBranch = args.sourceBranch.startsWith('refs/') 
          ? args.sourceBranch 
          : `refs/heads/${args.sourceBranch}`;
      }

      // Add parameters if specified
      if (args.parameters && typeof args.parameters === 'object') {
        buildRequest.parameters = JSON.stringify(args.parameters);
      }

      const result = await this.makeApiRequest(
        '/build/builds?api-version=7.1',
        'POST',
        buildRequest
      );

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            build: {
              id: result.id,
              buildNumber: result.buildNumber,
              status: result.status,
              queueTime: result.queueTime,
              definition: {
                id: result.definition.id,
                name: result.definition.name
              },
              sourceBranch: result.sourceBranch,
              url: result._links?.web?.href || `${this.currentConfig!.organizationUrl}/${this.currentConfig!.project}/_build/results?buildId=${result.id}`,
              requestedBy: {
                displayName: result.requestedBy?.displayName || 'API Request',
                uniqueName: result.requestedBy?.uniqueName || 'api'
              }
            }
          }, null, 2),
        }],
      };
    } catch (error) {
      throw new Error(`Failed to trigger pipeline: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get pipeline status and detailed information
   */
  private async getPipelineStatus(args: any): Promise<any> {
    try {
      if (args.buildId) {
        // Get specific build details
        const build = await this.makeApiRequest(`/build/builds/${args.buildId}?api-version=7.1`);
        
        let timeline = null;
        if (args.includeTimeline) {
          try {
            timeline = await this.makeApiRequest(`/build/builds/${args.buildId}/timeline?api-version=7.1`);
          } catch (timelineError) {
            // Sanitize error message to prevent log injection
            const sanitizedError = timelineError instanceof Error ? timelineError.message.replace(/[\r\n\t]/g, '_') : 'Unknown timeline error';
            console.error('Failed to get timeline:', sanitizedError);
            // Continue without timeline if it fails
          }
        }

        const buildInfo = {
          id: build.id,
          buildNumber: build.buildNumber,
          status: build.status,
          result: build.result,
          definition: {
            id: build.definition.id,
            name: build.definition.name
          },
          sourceBranch: build.sourceBranch,
          sourceVersion: build.sourceVersion,
          queueTime: build.queueTime,
          startTime: build.startTime,
          finishTime: build.finishTime,
          url: build._links?.web?.href,
          requestedBy: {
            displayName: build.requestedBy?.displayName,
            uniqueName: build.requestedBy?.uniqueName
          },
          ...(timeline && { 
            timeline: timeline.records?.map((record: any) => ({
              name: record.name,
              type: record.type,
              state: record.state,
              result: record.result,
              startTime: record.startTime,
              finishTime: record.finishTime,
              percentComplete: record.percentComplete
            }))
          })
        };

        return {
          content: [{
            type: 'text',
            text: JSON.stringify(buildInfo, null, 2),
          }],
        };
      } else if (args.definitionId) {
        // Get latest builds for a specific definition
        const builds = await this.makeApiRequest(
          `/build/builds?definitions=${args.definitionId}&$top=5&api-version=7.1`
        );

        const buildsInfo = builds.value.map((build: any) => ({
          id: build.id,
          buildNumber: build.buildNumber,
          status: build.status,
          result: build.result,
          sourceBranch: build.sourceBranch,
          queueTime: build.queueTime,
          startTime: build.startTime,
          finishTime: build.finishTime,
          url: build._links?.web?.href
        }));

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              definitionId: args.definitionId,
              recentBuilds: buildsInfo
            }, null, 2),
          }],
        };
      } else {
        throw new Error('Either buildId or definitionId must be provided');
      }
    } catch (error) {
      throw new Error(`Failed to get pipeline status: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}