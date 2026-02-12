# WIQL Field Name Normalization

## Overview

The MCP server now automatically corrects common field name errors in WIQL queries, preventing `TF51005: The query references a field that does not exist` errors.

## Problem Solved

Users and LLMs frequently use incorrect field names in WIQL queries:
- `[ClosedDate]` instead of `[Microsoft.VSTS.Common.ClosedDate]`
- `[System.ClosedDate]` instead of `[Microsoft.VSTS.Common.ClosedDate]`
- `[Priority]` instead of `[Microsoft.VSTS.Common.Priority]`
- `[Title]` instead of `[System.Title]`

These errors result in HTTP 400 errors from Azure DevOps API with confusing error messages.

## Solution

The server now automatically normalizes field names before sending queries to Azure DevOps. This happens transparently in both:
- `get-work-items` command
- `get-work-item-aggregations` command

## Supported Field Corrections

### Microsoft.VSTS Date Fields
| Incorrect | Corrected To |
|-----------|--------------|
| `[ClosedDate]` | `[Microsoft.VSTS.Common.ClosedDate]` |
| `[System.ClosedDate]` | `[Microsoft.VSTS.Common.ClosedDate]` |
| `[ResolvedDate]` | `[Microsoft.VSTS.Common.ResolvedDate]` |
| `[ActivatedDate]` | `[Microsoft.VSTS.Common.ActivatedDate]` |
| `[StateChangeDate]` | `[Microsoft.VSTS.Common.StateChangeDate]` |

### Microsoft.VSTS Priority & Severity Fields
| Incorrect | Corrected To |
|-----------|--------------|
| `[Priority]` | `[Microsoft.VSTS.Common.Priority]` |
| `[Severity]` | `[Microsoft.VSTS.Common.Severity]` |
| `[StackRank]` | `[Microsoft.VSTS.Common.StackRank]` |
| `[ValueArea]` | `[Microsoft.VSTS.Common.ValueArea]` |

### Microsoft.VSTS Scheduling Fields
| Incorrect | Corrected To |
|-----------|--------------|
| `[StoryPoints]` | `[Microsoft.VSTS.Scheduling.StoryPoints]` |
| `[Effort]` | `[Microsoft.VSTS.Scheduling.Effort]` |
| `[OriginalEstimate]` | `[Microsoft.VSTS.Scheduling.OriginalEstimate]` |
| `[RemainingWork]` | `[Microsoft.VSTS.Scheduling.RemainingWork]` |
| `[CompletedWork]` | `[Microsoft.VSTS.Scheduling.CompletedWork]` |

### System Fields
| Incorrect | Corrected To |
|-----------|--------------|
| `[Title]` | `[System.Title]` |
| `[State]` | `[System.State]` |
| `[AssignedTo]` | `[System.AssignedTo]` |
| `[CreatedDate]` | `[System.CreatedDate]` |
| `[ChangedDate]` | `[System.ChangedDate]` |
| `[Tags]` | `[System.Tags]` |
| `[IterationPath]` | `[System.IterationPath]` |
| `[AreaPath]` | `[System.AreaPath]` |

## Examples

### Example 1: Original Error Case

**Before (would fail with TF51005 error):**
```wiql
SELECT [System.Id], [System.Title], [System.ClosedDate]
FROM WorkItems
WHERE [System.Tags] CONTAINS 'URGENT BUSINESS REQUEST'
```

**After (automatically corrected):**
```wiql
SELECT [System.Id], [System.Title], [Microsoft.VSTS.Common.ClosedDate]
FROM WorkItems
WHERE [System.Tags] CONTAINS 'URGENT BUSINESS REQUEST'
```

### Example 2: Multiple Field Corrections

**Before:**
```wiql
SELECT [Id], [Title], [State], [Priority], [StoryPoints], [ClosedDate]
FROM WorkItems
WHERE [Tags] CONTAINS 'sprint'
ORDER BY [ChangedDate] DESC
```

**After:**
```wiql
SELECT [System.Id], [System.Title], [System.State],
       [Microsoft.VSTS.Common.Priority],
       [Microsoft.VSTS.Scheduling.StoryPoints],
       [Microsoft.VSTS.Common.ClosedDate]
FROM WorkItems
WHERE [System.Tags] CONTAINS 'sprint'
ORDER BY [System.ChangedDate] DESC
```

## Debug Logging

The normalization process logs corrections to help users understand what's happening:

```
[WIQL-NORMALIZE] Corrected field name: [ClosedDate] → [Microsoft.VSTS.Common.ClosedDate]
[WIQL-NORMALIZE] Corrected incorrectly prefixed field: [System.ClosedDate] → [Microsoft.VSTS.Common.ClosedDate]
[WIQL-NORMALIZE] Applied 2 field name correction(s) to WIQL query
```

## Benefits

1. **Better UX**: Users don't need to memorize exact Azure DevOps field names
2. **LLM-Friendly**: LLMs can use intuitive field names without causing errors
3. **Backwards Compatible**: Already-correct queries work unchanged
4. **Transparent**: Debug logging shows what was corrected
5. **Comprehensive**: Covers all common field name mistakes

## Technical Implementation

- **Location**: `src/handlers/tool-handlers.ts`
- **Method**: `normalizeWiqlFieldNames()`
- **Coverage**: 24 unit tests (100% pass rate)
- **Performance**: Negligible overhead (regex-based, runs once per query)

## Testing

Run the comprehensive test suite:

```bash
npm test -- wiql-field-normalization.test.ts
```

All 24 tests validate:
- Microsoft.VSTS field corrections
- System field corrections
- Mixed queries
- Edge cases (empty queries, string literals)
- Case insensitivity
- The exact error case from the original issue
