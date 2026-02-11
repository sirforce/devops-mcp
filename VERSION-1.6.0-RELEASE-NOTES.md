# Version 1.6.0 Release Notes

**Release Date**: February 11, 2026
**Previous Version**: 1.5.14
**Version Type**: Minor Release

---

## 🎉 What's New

### ✅ WIQL Query Support Fixed
The major feature of this release is the resolution of the WIQL query bug that prevented work item queries from functioning properly.

**What was fixed:**
- ✅ All WIQL queries now work correctly
- ✅ Support for TOP, ORDER BY, date filtering
- ✅ Support for WIQL macros (@today, @me, etc.)
- ✅ Complex queries with multiple conditions

**Example working queries:**
```bash
# Get active items updated today
mcp__devops-mcp__get-work-items --wiql "SELECT TOP 50 [System.Id], [System.Title] FROM WorkItems WHERE [System.State] = 'Active' AND [System.ChangedDate] >= @today"

# Get my active work items
mcp__devops-mcp__get-work-items --wiql "SELECT [System.Id], [System.Title] FROM WorkItems WHERE [System.AssignedTo] = @me AND [System.State] = 'Active'"

# Get high priority bugs
mcp__devops-mcp__get-work-items --wiql "SELECT TOP 20 [System.Id], [System.Title] FROM WorkItems WHERE [System.WorkItemType] = 'Bug' AND [Microsoft.VSTS.Common.Priority] <= 2"
```

---

## 📚 Documentation Updates

### New Documentation Files
1. **CHANGELOG.md** - Complete version history with security notes
2. **WIQL-FIX-DOCUMENTATION.md** - Comprehensive WIQL query guide
3. **VERSION-1.6.0-RELEASE-NOTES.md** - This file

### Updated Documentation
1. **CLAUDE.md** - Enhanced with security sections and localhost-only notices
2. **RESOLVED.md** - Added WIQL fix documentation
3. **.claudeignore** - Enhanced credential protection

---

## 🔒 Security Enhancements

### Localhost-Only Operation
**CRITICAL**: This MCP server is designed exclusively for localhost (127.0.0.1) use:

- ❌ **NOT available on NPM registry** - Package is marked as `private: true`
- ✅ **Local installation only** - Must be built from source
- ✅ **No network exposure** - Binds only to 127.0.0.1
- ✅ **No remote access** - Cannot be accessed from other machines

### Enhanced .claudeignore
The `.claudeignore` file now provides comprehensive credential protection:

```gitignore
# Azure DevOps configuration files (contains PAT tokens)
.azure-devops.json
**/.azure-devops.json

# Environment files
.env
.env.local
**/.env

# Token and credential files
*.pat
*.token
*.key
*.pem
credentials.json
secrets.json
```

**What this protects:**
- 🔒 PAT tokens never sent to Claude's servers
- 🔒 Configuration files stay on localhost
- 🔒 Credentials cannot be accidentally shared
- 🔒 Multi-project setups keep tokens isolated

### Read-Only PAT Tokens
Your Azure DevOps Personal Access Tokens should have **minimal permissions**:

**Required:**
- ✅ Work Items: Read & Write
- ✅ Code: Read
- ✅ Build: Read & Execute
- ✅ Project and Team: Read

**NOT Required:**
- ❌ Full Access (never use)
- ❌ Delete operations
- ❌ Admin permissions

---

## 🚀 Installation & Upgrade

### For New Installations

```bash
# 1. Clone or navigate to the repository
cd /path/to/devops-mcp

# 2. Install dependencies
npm install

# 3. Build the TypeScript code
npm run build

# 4. Install globally for localhost use
npm install -g

# 5. Configure MCP server in Claude Code
claude mcp add devops-mcp -- npx @sirforce/devops-mcp

# 6. Create your .azure-devops.json configuration
cat > .azure-devops.json << EOF
{
  "organizationUrl": "https://dev.azure.com/your-org",
  "project": "YourProject",
  "pat": "your-pat-token-here",
  "description": "Azure DevOps configuration"
}
EOF

# 7. Verify .claudeignore is protecting credentials
cat .claudeignore
```

### For Existing Installations

```bash
# 1. Navigate to your installation
cd /path/to/devops-mcp

# 2. Pull latest changes (if from git)
git pull

# 3. Rebuild
npm run build

# 4. Reinstall globally
npm install -g

# 5. Kill the old MCP server process
ps aux | grep devops-mcp | grep -v grep
kill <PID>

# 6. Restart Claude Code or trigger MCP server restart
claude mcp list
```

---

## 🧪 Testing the Release

### Verify WIQL Queries Work

```bash
# Test 1: Basic query
mcp__devops-mcp__get-work-items --wiql "SELECT TOP 5 [System.Id], [System.Title] FROM WorkItems WHERE [System.State] = 'Active'"

# Test 2: Date filtering
mcp__devops-mcp__get-work-items --wiql "SELECT [System.Id], [System.Title] FROM WorkItems WHERE [System.ChangedDate] >= @today"

# Test 3: Assignment
mcp__devops-mcp__get-work-items --wiql "SELECT [System.Id], [System.Title] FROM WorkItems WHERE [System.AssignedTo] = @me"
```

### Verify Security Configuration

```bash
# Check .claudeignore exists and contains .azure-devops.json
grep -i azure .claudeignore

# Verify .azure-devops.json is NOT in version control
git status | grep -i azure || echo "✅ Configuration file not tracked"

# Verify MCP server version
npm list -g @sirforce/devops-mcp
```

---

## 📊 Files Changed in This Release

### Modified Files
- `package.json` - Version bumped to 1.6.0
- `CLAUDE.md` - Added security sections and localhost-only notices
- `RESOLVED.md` - Added WIQL fix documentation
- `.claudeignore` - Enhanced credential protection patterns

### New Files
- `CHANGELOG.md` - Complete version history
- `WIQL-FIX-DOCUMENTATION.md` - Comprehensive WIQL guide
- `VERSION-1.6.0-RELEASE-NOTES.md` - This file
- `test-mcp-wiql.js` - Direct WIQL testing script
- `test-wiql.js` - Azure DevOps API testing script
- `get-active-items.js` - Utility script

---

## 🐛 Known Issues

None at this time. All major functionality has been tested and verified.

---

## 🔮 Future Enhancements

### Potential Features for v1.7.0+
- Remove debug logging for cleaner production output
- Additional WIQL query optimization
- Enhanced error messages and troubleshooting
- Batch operations support
- Webhook integration for real-time updates

---

## 📞 Support & Feedback

- **GitHub Issues**: https://github.com/sirforce/devops-mcp/issues
- **Documentation**: See CLAUDE.md, README.md, WIQL-FIX-DOCUMENTATION.md
- **Security Concerns**: Always verify .claudeignore before sharing projects

---

## ✅ Checklist for Upgrading

- [ ] Pulled latest changes from repository
- [ ] Ran `npm install` to update dependencies
- [ ] Ran `npm run build` to rebuild TypeScript
- [ ] Ran `npm install -g` to reinstall globally
- [ ] Killed old MCP server process
- [ ] Restarted Claude Code or triggered MCP restart
- [ ] Verified .claudeignore contains .azure-devops.json
- [ ] Tested WIQL queries work correctly
- [ ] Verified PAT token has minimal permissions
- [ ] Confirmed .azure-devops.json is in .gitignore

---

**Version**: 1.6.0
**Status**: ✅ Production Ready
**Distribution**: Localhost (127.0.0.1) Only
**Security**: Enhanced with comprehensive .claudeignore
**WIQL Support**: ✅ Fully Functional
