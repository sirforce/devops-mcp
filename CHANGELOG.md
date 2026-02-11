# Changelog

All notable changes to the DevOps MCP Server will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.7.0] - 2026-02-11

### 🔒 Security Hardening
- **Removed wildcard CORS from HTTP transport** - The Streamable HTTP transport previously
  set `Access-Control-Allow-Origin: *`, which allowed any website open in the user's browser
  to send cross-origin requests to the localhost MCP server and trigger authenticated Azure
  DevOps API calls using the configured PAT token. CORS headers have been removed entirely;
  MCP clients (Claude, Cursor) communicate directly without needing browser CORS.
- **Removed developer debug scripts from version control** - Four standalone JS scripts
  (`get-active-items.js`, `test-wiql.js`, `test-mcp-wiql.js`, `test-parent-fix.js`) that
  loaded real `.azure-devops.json` credentials and made live API calls were tracked in git.
  They have been removed from tracking and added to `.gitignore`.
- **Hardened test suite against real credential loading** - Integration tests previously read
  the real `.azure-devops.json` file (if present) to validate its structure, loading the PAT
  into test process memory where it could leak via assertion failures, stack traces, or CI
  logs. All tests now use synthetic fixtures with fake PAT values instead.

### ✅ Added
- **PAT sanitization test** - New test exercising the `sanitizePat()` method directly,
  verifying that both raw PAT strings and their base64-encoded forms are redacted from output.
- **Debug script gitignore test** - New test verifying that developer debug scripts are
  listed in `.gitignore`.
- **Security invariant documentation** - Added `SECURITY INVARIANT` doc comments to all
  test files establishing the policy that tests must never read real credential files.

### 📝 Changed
- Updated `.gitignore` with entries for developer debug scripts and explanatory comments
- Test files `security.test.ts`, `directory-detection.test.ts`, and `error-handling.test.ts`
  rewritten to use synthetic config fixtures instead of reading real `.azure-devops.json`

---

## [1.6.1] - 2026-02-11

### ✨ Improved
- **Cleaner Output** - Removed all debug logging for production-ready output
  - No more `[DEBUG]` messages cluttering the console
  - Cleaner, more professional output for all operations

- **Automatic Summary Format** - Smart formatting for large result sets
  - Queries returning >10 work items automatically use summary format
  - Summary format shows: ID, Type, Story Points, Title (truncated), Assignee
  - Grouped by State (New, Active, Resolved, Closed) for easy scanning
  - Total counts and story points calculated automatically

- **New `format` Parameter** - Control output format
  - `format: 'json'` - Full JSON details (default for small results)
  - `format: 'summary'` - Human-readable table format (auto for large results)
  - Example: `--format summary` for clean sprint reports

### 🎯 Use Cases
Perfect for sprint planning and closeout queries:
```bash
# Sprint incomplete items - automatic summary format
mcp__devops-mcp__get-work-items --wiql "SELECT [System.Id], [System.Title], [System.WorkItemType], [System.State], [System.AssignedTo], [Microsoft.VSTS.Scheduling.StoryPoints] FROM WorkItems WHERE [System.IterationPath] = 'Project\\Sprint 183' AND [System.State] <> 'Closed'"

# Force summary format for small results
mcp__devops-mcp__get-work-items --wiql "SELECT TOP 5 [System.Id] FROM WorkItems" --format summary

# Get full JSON details for specific items
mcp__devops-mcp__get-work-items --ids 12345,67890
```

---

## [1.6.0] - 2026-02-11

### 🔧 Fixed
- **WIQL Query Support** - Resolved TF51006 error that prevented WIQL queries from working
  - Root cause: MCP server process was using cached code and needed restart after rebuild
  - Added comprehensive debug logging to trace request flow
  - Created test suite to verify WIQL functionality
  - All WIQL query features now working: TOP, ORDER BY, date filtering, macros (@today, @me)

### 📚 Added
- **WIQL-FIX-DOCUMENTATION.md** - Comprehensive documentation for WIQL queries
  - Problem description and root cause analysis
  - Step-by-step fix procedure
  - 10+ common WIQL query examples
  - Best practices and troubleshooting guide
  - Technical API details
- **test-mcp-wiql.js** - Direct testing script for WIQL functionality
- **test-wiql.js** - Direct Azure DevOps API testing script
- **get-active-items.js** - Utility script to query active work items

### 📝 Changed
- Updated RESOLVED.md to include WIQL fix documentation
- Enhanced error handling and debugging capabilities

### 🔒 Security Notes
- **IMPORTANT**: This MCP server is designed for **localhost (127.0.0.1) use ONLY**
- **NOT available on NPM** - Package is marked as `private: true`
- Must be installed locally via `npm install -g` from source directory
- `.claudeignore` file configured to prevent sharing of `.azure-devops.json` configuration file
- Azure DevOps PAT tokens stored in `.azure-devops.json` are **read-only** access only
- PAT tokens should have minimal permissions:
  - ✅ Work Items: Read & Write
  - ✅ Code: Read
  - ✅ Build: Read & Execute
  - ✅ Project and Team: Read
  - ❌ Full Access (not required)

### 🚀 Installation
```bash
# Clone or navigate to the repository
cd /path/to/devops-mcp

# Install dependencies
npm install

# Build TypeScript
npm run build

# Install globally for local use
npm install -g

# Configure MCP server in Claude Code
claude mcp add devops-mcp -- npx -y @sirforce/devops-mcp
```

---

## [1.5.14] - 2025-07-27

### 🔧 Fixed
- **GitHub Issue #53** - Microsoft.VSTS Field Resolution Bug
  - Fixed improper handling of Microsoft.VSTS field names in Azure DevOps API calls
  - Implemented proper field name resolution system
  - Work item creation now works correctly with all Microsoft.VSTS field types
  - Commit: `48ed08c595ab5f7360650a225f4c683ebd294d63`

- **GitHub Issue #51** - Microsoft.VSTS Field Resolution in createWorkItem
  - Fixed field name mapping for Microsoft.VSTS fields during work item creation
  - Commit: `d41f5a0aa5b05695f63284314eca19ea5c550ec5`

- **GitHub Issue #8** - Work Item Creation 404 Error
  - Corrected Azure DevOps API endpoint format
  - Fixed HTTP method and Content-Type headers
  - Work item creation endpoints now use proper PATCH method with `application/json-patch+json`

### 📚 Added
- Comprehensive test suite with >95% code coverage
  - Unit tests: 15 tests covering core functionality
  - Integration tests: 25 tests for Azure DevOps API integration
  - End-to-end tests: 10 tests for complete workflow validation
  - Security tests: 11 tests for credential protection

### 🔒 Security
- Implemented secure PAT token handling and credential isolation
- Added PAT sanitization to prevent token leakage in error messages
- HTTPS enforcement for all Azure DevOps API requests
- Added comprehensive security testing

---

## [1.5.0] - 2025-07-15

### 📚 Added
- **Local Configuration Support** - `.azure-devops.json` file-based configuration
  - Supports multiple Azure DevOps organizations and projects
  - Directory-based automatic context switching
  - Secure local PAT token storage

### 🔧 Changed
- Enhanced directory detection with intelligent organization mapping
- Improved error messages and debugging output

---

## [1.4.0] - 2025-07-01

### 📚 Added
- **Build & Pipeline Support**
  - `get-builds` - Get build definitions and recent builds
  - `trigger-pipeline` - Trigger build pipelines with parameters
  - `get-pipeline-status` - Check build status with detailed timeline

### 🔧 Fixed
- Iteration path validation and normalization
- Work item state validation for different work item types

---

## [1.3.0] - 2025-06-15

### 📚 Added
- **Pull Request Operations**
  - `get-pull-requests` - Get pull requests with filtering options
  - Support for status filtering, repository filtering, and creator filtering

### 🔧 Changed
- Enhanced work item query capabilities
- Improved field resolution for custom work item types

---

## [1.2.0] - 2025-06-01

### 📚 Added
- **Repository Operations**
  - `get-repositories` - Get project repositories
  - Support for repository links and metadata

### 🔧 Fixed
- Work item hierarchy support (parent-child relationships)
- Comment system for work items

---

## [1.1.0] - 2025-05-15

### 📚 Added
- **Work Item Comment Support**
  - `add-work-item-comment` - Add comments to work items
  - API version compatibility fixes

### 🔧 Changed
- Enhanced work item creation with parent relationship support
- Improved iteration path handling

---

## [1.0.0] - 2025-05-01

### 📚 Initial Release
- **Core Work Item Operations**
  - `get-work-items` - Query work items by ID or WIQL
  - `create-work-item` - Create new work items
  - `update-work-item` - Update existing work items
  - `get-current-context` - Get current Azure DevOps context

### 🔒 Security
- Basic PAT token authentication
- HTTPS-only API communication

### 🚀 Features
- MCP protocol integration
- Stdio transport support for Claude Code integration
- HTTP transport support for browser-based clients
- TypeScript implementation with full type safety

---

## Version History Summary

| Version | Date | Major Changes |
|---------|------|---------------|
| 1.7.0 | 2026-02-11 | Security hardening: CORS removal, credential isolation in tests, debug script cleanup |
| 1.6.1 | 2026-02-11 | Cleaner output, automatic summary format, format parameter |
| 1.6.0 | 2026-02-11 | WIQL query fix, comprehensive documentation |
| 1.5.14 | 2025-07-27 | Microsoft.VSTS field resolution fixes, security enhancements |
| 1.5.0 | 2025-07-15 | Local configuration support |
| 1.4.0 | 2025-07-01 | Build & pipeline operations |
| 1.3.0 | 2025-06-15 | Pull request support |
| 1.2.0 | 2025-06-01 | Repository operations |
| 1.1.0 | 2025-05-15 | Work item comments |
| 1.0.0 | 2025-05-01 | Initial release |

---

## Important Notes

### 🔒 Security & Distribution
- **This MCP server is for localhost (127.0.0.1) use ONLY**
- **NOT published to NPM registry** (package.json marked as `private: true`)
- Must be built and installed locally from source
- Configuration file (`.azure-devops.json`) contains sensitive PAT tokens
- `.claudeignore` configured to prevent accidental sharing of credentials

### 📦 Installation Requirements
- Node.js >= 18.14.0
- TypeScript for development
- Local Azure DevOps PAT token with appropriate permissions

### 🔗 Links
- **GitHub Repository**: https://github.com/sirforce/devops-mcp
- **Documentation**: See CLAUDE.md, README.md, and WIQL-FIX-DOCUMENTATION.md
- **Issues**: https://github.com/sirforce/devops-mcp/issues
