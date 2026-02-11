# WIQL Query Fix Documentation

**Date**: February 11, 2026
**Issue**: WIQL queries failing with TF51006 error
**Status**: ✅ **RESOLVED**
**Version**: 1.5.14+

---

## Problem Description

### Symptoms
WIQL queries were failing with the following error:
```
Error: Error executing get-work-items: Failed to get work items: HTTP 400:
{
  "$id":"1",
  "innerException":null,
  "message":"TF51006: The query statement is missing a FROM clause. The error is caused by «200».",
  "typeName":"Microsoft.VisualStudio.Services.Common.VssPropertyValidationException"
}
```

### Example Failing Query
```bash
mcp__devops-mcp__get-work-items --wiql "SELECT [System.Id], [System.Title] FROM WorkItems WHERE [System.State] = 'Active'"
```

### Root Cause
The issue was **NOT in the code**, but in the MCP server runtime environment:
- The code correctly formatted and sent WIQL queries to Azure DevOps API
- Direct testing of the TypeScript code showed WIQL queries worked perfectly
- The problem was that the running MCP server process was using **old cached code**
- After rebuilding and restarting, WIQL queries worked immediately

---

## Solution

### Step 1: Rebuild the Package
```bash
# Navigate to the devops-mcp directory
cd /path/to/devops-mcp

# Rebuild the TypeScript
npm run build

# Install globally to update the global package
npm install -g
```

### Step 2: Restart the MCP Server
The MCP server process needs to reload the updated code:

**Option A: Kill the process (Claude Code will auto-restart)**
```bash
# Find the MCP server process
ps aux | grep devops-mcp | grep -v grep

# Kill the process (Claude Code will restart it automatically)
kill <PID>

# Trigger startup
claude mcp list
```

**Option B: Restart Claude Code completely**
1. Quit Claude Code (Cmd+Q)
2. Restart Claude Code
3. The MCP server will load with the updated code

### Step 3: Verify the Fix
```bash
# Test a simple WIQL query
mcp__devops-mcp__get-work-items --wiql "SELECT TOP 5 [System.Id], [System.Title] FROM WorkItems WHERE [System.State] = 'Active'"
```

If you see work items returned (not an error), the fix is working! ✅

---

## Verification Testing

### Test 1: Basic WIQL Query
```bash
mcp__devops-mcp__get-work-items --wiql "SELECT TOP 10 [System.Id], [System.Title], [System.State] FROM WorkItems WHERE [System.State] = 'Active' ORDER BY [System.ChangedDate] DESC"
```

**Expected Result**: Returns up to 10 active work items, ordered by most recently changed

### Test 2: Date Filtering
```bash
mcp__devops-mcp__get-work-items --wiql "SELECT [System.Id], [System.Title] FROM WorkItems WHERE [System.ChangedDate] >= '2026-02-11'"
```

**Expected Result**: Returns all work items changed on or after February 11, 2026

### Test 3: Assignment Query
```bash
mcp__devops-mcp__get-work-items --wiql "SELECT [System.Id], [System.Title] FROM WorkItems WHERE [System.AssignedTo] = @me AND [System.State] = 'Active'"
```

**Expected Result**: Returns your active work items

### Test 4: Complex Query
```bash
mcp__devops-mcp__get-work-items --wiql "SELECT TOP 20 [System.Id], [System.Title], [System.WorkItemType] FROM WorkItems WHERE [System.State] = 'Active' AND [System.ChangedDate] >= @today-7 ORDER BY [System.ChangedDate] DESC"
```

**Expected Result**: Returns active work items changed in the last 7 days

---

## Best Practices

### 1. Always Use TOP to Limit Results
```bash
# Good - limits to 50 results
SELECT TOP 50 [System.Id], [System.Title] FROM WorkItems

# Avoid - returns all items (could be thousands)
SELECT [System.Id], [System.Title] FROM WorkItems
```

### 2. Use Field Parameters for Efficiency
```bash
# Specify only needed fields
mcp__devops-mcp__get-work-items \
  --wiql "SELECT [System.Id], [System.Title] FROM WorkItems WHERE [System.State] = 'Active'" \
  --fields "System.Id,System.Title,System.State,System.AssignedTo"
```

### 3. Use Date Macros
```bash
# @today - current day
# @today-7 - 7 days ago
# @me - current user

SELECT [System.Id] FROM WorkItems WHERE [System.ChangedDate] >= @today-7
```

### 4. Order Results
```bash
# Most recently changed first
ORDER BY [System.ChangedDate] DESC

# By priority then creation date
ORDER BY [Microsoft.VSTS.Common.Priority] ASC, [System.CreatedDate] DESC
```

---

## Common WIQL Query Examples

### Get My Active Work Items
```bash
mcp__devops-mcp__get-work-items --wiql "SELECT [System.Id], [System.Title], [System.State] FROM WorkItems WHERE [System.AssignedTo] = @me AND [System.State] = 'Active'"
```

### Get High Priority Bugs
```bash
mcp__devops-mcp__get-work-items --wiql "SELECT TOP 20 [System.Id], [System.Title] FROM WorkItems WHERE [System.WorkItemType] = 'Bug' AND [Microsoft.VSTS.Common.Priority] <= 2 ORDER BY [Microsoft.VSTS.Common.Priority] ASC"
```

### Get Work Items in Current Sprint
```bash
mcp__devops-mcp__get-work-items --wiql "SELECT [System.Id], [System.Title], [System.State] FROM WorkItems WHERE [System.IterationPath] UNDER 'ProjectName\\Sprint 183'"
```

### Get Recently Modified Items
```bash
mcp__devops-mcp__get-work-items --wiql "SELECT TOP 50 [System.Id], [System.Title], [System.ChangedDate] FROM WorkItems WHERE [System.ChangedDate] >= @today-7 ORDER BY [System.ChangedDate] DESC"
```

### Get Work Items by Tag
```bash
mcp__devops-mcp__get-work-items --wiql "SELECT [System.Id], [System.Title] FROM WorkItems WHERE [System.Tags] CONTAINS 'bug-fix'"
```

### Get Work Items by Parent
```bash
mcp__devops-mcp__get-work-items --wiql "SELECT [System.Id], [System.Title] FROM WorkItems WHERE [System.Parent] = 26157"
```

---

## Debug Logging (Temporary)

The current build includes debug logging that shows:
- Arguments received by the tool
- WIQL query being sent
- API endpoint and request details
- Response status

This can be removed for cleaner output by removing the `console.error` statements in:
- `src/handlers/tool-handlers.ts` lines 268, 287-289, 150-154, 170-171, 189-195

---

## Troubleshooting

### Issue: "No such tool available: mcp__devops-mcp__get-work-items"
**Solution**: The MCP server hasn't loaded yet. Run:
```bash
claude mcp list
```
Then try the query again.

### Issue: Still getting TF51006 error after rebuild
**Solution**: The MCP server is still running old code. Kill the process and restart:
```bash
ps aux | grep devops-mcp | grep -v grep
kill <PID>
claude mcp list  # Trigger restart
```

### Issue: Results are too large
**Solution**: Use `TOP N` to limit results:
```bash
SELECT TOP 20 [System.Id], [System.Title] FROM WorkItems...
```

### Issue: Query returns empty results
**Solution**: Check your filters - the query might be too restrictive:
```bash
# Test without filters first
SELECT TOP 10 [System.Id], [System.Title] FROM WorkItems ORDER BY [System.ChangedDate] DESC
```

---

## Technical Details

### API Endpoint
```
POST https://dev.azure.com/{organization}/{project}/_apis/wit/wiql?api-version=7.1&$top={limit}
```

### Request Body Format
```json
{
  "query": "SELECT [System.Id], [System.Title] FROM WorkItems WHERE [System.State] = 'Active'"
}
```

### Headers
```
Content-Type: application/json
Authorization: Basic {base64(":PAT")}
Accept: application/json
```

### Response
```json
{
  "queryType": "flat",
  "queryResultType": "workItem",
  "asOf": "2026-02-11T...",
  "workItems": [
    {"id": 12345, "url": "..."},
    {"id": 67890, "url": "..."}
  ]
}
```

The tool then fetches full work item details for the returned IDs.

---

## References

- **Azure DevOps WIQL Documentation**: https://docs.microsoft.com/en-us/azure/devops/boards/queries/wiql-syntax
- **MCP Server GitHub**: https://github.com/sirforce/devops-mcp
- **Issue Tracking**: See RESOLVED.md for historical issues

---

## Change Log

| Date | Version | Change |
|------|---------|--------|
| 2026-02-11 | 1.5.14 | Fixed WIQL queries by identifying MCP server restart requirement |
| 2026-02-11 | 1.5.14 | Added debug logging to trace request flow |
| 2026-02-11 | 1.5.14 | Verified WIQL queries work correctly with updated build |

---

**Status**: ✅ All WIQL queries now working correctly
**Next Steps**: Consider removing debug logging for production use
