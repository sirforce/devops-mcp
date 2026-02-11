#!/usr/bin/env node
/**
 * Azure DevOps MCP Proxy Server
 * Main entry point for the dynamic Azure DevOps MCP proxy
 * Supports both stdio and HTTP (Streamable HTTP) transports
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  isInitializeRequest,
} from '@modelcontextprotocol/sdk/types.js';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { DirectoryDetector } from './directory-detector.js';
import { ConfigLoader } from './utils/config-loader.js';
import { LocalConfigLoader } from './utils/local-config-loader.js';
import { ToolHandlers } from './handlers/tool-handlers.js';
import { AzureDevOpsConfig } from './types/index.js';

/**
 * Parse command-line arguments for transport configuration.
 */
function parseArgs(): { transport: 'stdio' | 'http'; port: number; host: string; configPath?: string } {
  const args = process.argv.slice(2);
  let transport: 'stdio' | 'http' = 'stdio';
  let port = 3000;
  let host = '127.0.0.1';
  let configPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--transport':
        if (args[i + 1] === 'http' || args[i + 1] === 'stdio') {
          transport = args[i + 1] as 'stdio' | 'http';
        } else {
          console.error(`Invalid transport: ${args[i + 1]}. Use 'stdio' or 'http'.`);
          process.exit(1);
        }
        i++;
        break;
      case '--http':
        transport = 'http';
        break;
      case '--port':
        port = parseInt(args[i + 1], 10);
        if (isNaN(port) || port < 1 || port > 65535) {
          console.error(`Invalid port: ${args[i + 1]}`);
          process.exit(1);
        }
        i++;
        break;
      case '--host':
        host = args[i + 1];
        i++;
        break;
      case '--config':
        configPath = args[i + 1];
        i++;
        break;
      case '--help':
      case '-h':
        console.log(`
Azure DevOps MCP Server

Usage: devops-mcp [options]

Options:
  --transport <stdio|http>  Transport mode (default: stdio)
  --http                    Shorthand for --transport http
  --port <number>           HTTP port to listen on (default: 3000)
  --host <address>          HTTP host to bind to (default: 127.0.0.1)
  --config <path>           Path to .azure-devops.json config file
  -h, --help                Show this help message

Examples:
  devops-mcp                                  # stdio mode (default)
  devops-mcp --http --port 8080               # HTTP on port 8080
  devops-mcp --http --config /path/to/.azure-devops.json
`);
        process.exit(0);
    }
  }

  return { transport, port, host, configPath };
}

class AzureDevOpsMCPProxy {
  private directoryDetector!: DirectoryDetector;
  private toolHandlers: ToolHandlers;
  private currentConfig: AzureDevOpsConfig | null = null;
  private configPath?: string;

  constructor(configPath?: string) {
    this.toolHandlers = new ToolHandlers();
    this.configPath = configPath;
    this.initializeConfiguration();
  }

  /**
   * Create a new MCP Server instance with all handlers configured.
   * Each transport session requires its own Server instance.
   */
  createMCPServer(): Server {
    const server = new Server(
      {
        name: 'devops-mcp',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers(server);
    return server;
  }

  /**
   * Initialize configuration from local .azure-devops.json files
   */
  private initializeConfiguration(): void {
    try {
      // If explicit config path provided, load from there
      if (this.configPath) {
        this.currentConfig = LocalConfigLoader.loadFromPath(this.configPath);
        if (this.currentConfig) {
          this.toolHandlers.setCurrentConfig(this.currentConfig);
          console.error('Azure DevOps MCP Proxy initialized with config from:', this.configPath);
          return;
        } else {
          console.error(`Warning: Could not load config from ${this.configPath}, falling back to discovery`);
        }
      }

      // Try loading local configuration first
      this.currentConfig = LocalConfigLoader.findLocalConfig();
      
      if (this.currentConfig) {
        this.toolHandlers.setCurrentConfig(this.currentConfig);
        console.error('Azure DevOps MCP Proxy initialized with local configuration:', {
          organizationUrl: this.currentConfig.organizationUrl,
          project: this.currentConfig.project,
          directory: process.cwd()
        });
        return;
      }

      // Fallback to environment-based configuration
      console.error('No local configuration found, trying environment-based config...');
      try {
        const envConfig = ConfigLoader.loadConfig();
        this.directoryDetector = new DirectoryDetector(
          envConfig.mappings,
          envConfig.defaultConfig
        );
        
        this.currentConfig = this.directoryDetector.detectConfiguration();
      } catch (error) {
        // Environment config file doesn't exist - this is normal in the new system
        console.error('No environment configuration found - operating in local-only mode');
        this.currentConfig = null;
      }
      if (this.currentConfig) {
        this.toolHandlers.setCurrentConfig(this.currentConfig);
        console.error('Azure DevOps MCP Proxy initialized with environment configuration:', {
          organizationUrl: this.currentConfig.organizationUrl,
          project: this.currentConfig.project
        });
      } else {
        console.warn('No Azure DevOps configuration detected for current directory');
        console.error('Consider creating a .azure-devops.json file in your repository');
      }
    } catch (error) {
      console.error('Failed to initialize configuration:', error);
      // Initialize with empty configuration as fallback
      this.directoryDetector = new DirectoryDetector([]);
    }
  }

  /**
   * Setup MCP server handlers on a given Server instance
   */
  private setupHandlers(server: Server): void {
    // List available tools
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools = [
        {
          name: 'get-work-items',
          description: 'Get work items from Azure DevOps',
          inputSchema: {
            type: 'object',
            properties: {
              wiql: {
                type: 'string',
                description: 'Work Item Query Language (WIQL) query',
              },
              ids: {
                type: 'array',
                items: { type: 'number' },
                description: 'Specific work item IDs to retrieve',
              },
              fields: {
                type: 'array',
                items: { type: 'string' },
                description: 'Fields to include in the response',
              },
              format: {
                type: 'string',
                enum: ['json', 'summary'],
                description: 'Output format: "json" (default, full details) or "summary" (formatted table for large results)',
              },
            },
          },
        },
        {
          name: 'create-work-item',
          description: 'Create a new work item in Azure DevOps',
          inputSchema: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                description: 'Work item type (e.g., Task, Bug, User Story)',
              },
              title: {
                type: 'string',
                description: 'Work item title',
              },
              description: {
                type: 'string',
                description: 'Work item description',
              },
              assignedTo: {
                type: 'string',
                description: 'Email of the person to assign the work item to',
              },
              tags: {
                type: 'string',
                description: 'Semicolon-separated tags',
              },
              parent: {
                type: 'number',
                description: 'Parent work item ID for establishing hierarchy during creation',
              },
              iterationPath: {
                type: 'string',
                description: 'Iteration path for sprint assignment (e.g., ProjectName\\Sprint 1)',
              },
              state: {
                type: 'string',
                description: 'Initial work item state (e.g., New, Active)',
              },
            },
            required: ['type', 'title'],
          },
        },
        {
          name: 'update-work-item',
          description: 'Update an existing work item in Azure DevOps',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'number',
                description: 'Work item ID to update',
              },
              title: {
                type: 'string',
                description: 'Updated work item title',
              },
              description: {
                type: 'string',
                description: 'Updated work item description',
              },
              state: {
                type: 'string',
                description: 'Updated work item state (e.g., Active, Resolved, Closed)',
              },
              assignedTo: {
                type: 'string',
                description: 'Email of the person to assign the work item to',
              },
              parent: {
                type: 'number',
                description: 'Parent work item ID for establishing hierarchy',
              },
              iterationPath: {
                type: 'string',
                description: 'Iteration path for sprint assignment (e.g., ProjectName\\Sprint 1)',
              },
              tags: {
                type: 'string',
                description: 'Semicolon-separated tags',
              },
              fields: {
                type: 'object',
                description: 'Generic field updates as key-value pairs',
              },
            },
            required: ['id'],
          },
        },
        {
          name: 'add-work-item-comment',
          description: 'Add a comment to an existing work item in Azure DevOps',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'number',
                description: 'Work item ID to add comment to',
              },
              comment: {
                type: 'string',
                description: 'Comment text to add',
              },
            },
            required: ['id', 'comment'],
          },
        },
        {
          name: 'get-repositories',
          description: 'Get repositories from Azure DevOps project',
          inputSchema: {
            type: 'object',
            properties: {
              includeLinks: {
                type: 'boolean',
                description: 'Include repository links in response',
              },
            },
          },
        },
        {
          name: 'get-builds',
          description: 'Get build definitions and recent builds',
          inputSchema: {
            type: 'object',
            properties: {
              definitionIds: {
                type: 'array',
                items: { type: 'number' },
                description: 'Specific build definition IDs',
              },
              top: {
                type: 'number',
                description: 'Number of builds to return',
              },
            },
          },
        },
        {
          name: 'get-pull-requests',
          description: 'Get pull requests from Azure DevOps repository',
          inputSchema: {
            type: 'object',
            properties: {
              repositoryId: {
                type: 'string',
                description: 'Repository ID or name (optional, defaults to all repos)',
              },
              status: {
                type: 'string',
                enum: ['active', 'completed', 'abandoned', 'all'],
                description: 'Pull request status filter (default: active)',
              },
              createdBy: {
                type: 'string',
                description: 'Filter by creator (user ID or email)',
              },
              top: {
                type: 'number',
                description: 'Number of pull requests to return (default: 25)',
              },
            },
          },
        },
        {
          name: 'trigger-pipeline',
          description: 'Trigger a build pipeline in Azure DevOps',
          inputSchema: {
            type: 'object',
            properties: {
              definitionId: {
                type: 'number',
                description: 'Build definition ID to trigger',
              },
              definitionName: {
                type: 'string',
                description: 'Build definition name (alternative to ID)',
              },
              sourceBranch: {
                type: 'string',
                description: 'Source branch to build (default: default branch)',
              },
              parameters: {
                type: 'object',
                description: 'Pipeline parameters as key-value pairs',
              },
            },
          },
        },
        {
          name: 'get-pipeline-status',
          description: 'Get status of a specific build or pipeline',
          inputSchema: {
            type: 'object',
            properties: {
              buildId: {
                type: 'number',
                description: 'Specific build ID to check status',
              },
              definitionId: {
                type: 'number',
                description: 'Get latest builds for this definition ID',
              },
              includeTimeline: {
                type: 'boolean',
                description: 'Include detailed timeline information',
              },
            },
          },
        },
        {
          name: 'get-current-context',
          description: 'Get current Azure DevOps context based on directory',
          inputSchema: {
            type: 'object',
            properties: {
              directory: {
                type: 'string',
                description: 'Directory path to check (defaults to current working directory)',
              },
            },
          },
        },
      ];

      return { tools };
    });

    // Handle tool calls
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        // Detect current environment context
        await this.updateCurrentContext();

        if (!this.currentConfig) {
          return {
            content: [{
              type: 'text',
              text: 'Error: No Azure DevOps configuration found for current directory. Please ensure you are in a configured project directory.',
            }],
            isError: true,
          };
        }

        // Handle special context tool
        if (request.params.name === 'get-current-context') {
          return this.handleGetCurrentContext(request.params.arguments);
        }

        // Route to tool handlers with current context
        return await this.toolHandlers.handleToolCall(request);
      } catch (error) {
        console.error('Tool call error:', error);
        return {
          content: [{
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`,
          }],
          isError: true,
        };
      }
    });
  }

  /**
   * Update current Azure DevOps context based on working directory
   */
  private async updateCurrentContext(): Promise<void> {
    // Skip update if using local configuration (no directory detector)
    if (!this.directoryDetector) {
      return;
    }

    const detectedConfig = this.directoryDetector.detectConfiguration();
    
    if (detectedConfig && (!this.currentConfig || 
        this.currentConfig.organizationUrl !== detectedConfig.organizationUrl ||
        this.currentConfig.project !== detectedConfig.project)) {
      
      this.currentConfig = detectedConfig;
      this.toolHandlers.setCurrentConfig(detectedConfig);
      
      console.error(`Switched to Azure DevOps context: ${detectedConfig.organizationUrl}/${detectedConfig.project}`);
    }
  }

  /**
   * Handle get-current-context tool call
   */
  private handleGetCurrentContext(args?: any): any {
    const directory = args?.directory || process.cwd();
    
    // If using local configuration, return current config
    if (!this.directoryDetector && this.currentConfig) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            organizationUrl: this.currentConfig.organizationUrl,
            project: this.currentConfig.project,
            directory: directory,
            configurationSource: 'local',
            configFile: '.azure-devops.json'
          }, null, 2),
        }],
      };
    }

    // Fall back to directory detector if available
    if (this.directoryDetector) {
      const context = this.directoryDetector.getProjectContext(directory);
      
      if (!context) {
        return {
          content: [{
            type: 'text',
            text: 'No Azure DevOps context configured for the specified directory.',
          }],
        };
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            organizationUrl: context.organizationUrl,
            project: context.projectName,
            directory: directory,
            configurationSource: 'environment',
            configuredDirectories: this.directoryDetector.getConfiguredDirectories(),
          }, null, 2),
        }],
      };
    }

    return {
      content: [{
        type: 'text',
        text: 'No Azure DevOps configuration found.',
      }],
    };
  }

  /**
   * Start the MCP server in stdio mode (default, for Claude/Cursor integration)
   */
  async startStdio(): Promise<void> {
    const server = this.createMCPServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('Azure DevOps MCP Proxy Server started (stdio transport)');
  }

  /**
   * Start the MCP server in HTTP mode (Streamable HTTP transport)
   * Listens on the specified host:port and manages sessions.
   */
  async startHttp(port: number, host: string): Promise<void> {
    // Map of active session transports
    const transports: Record<string, StreamableHTTPServerTransport> = {};

    /**
     * Parse the JSON body from an incoming HTTP request.
     */
    const parseBody = (req: IncomingMessage): Promise<unknown> => {
      return new Promise((resolve, reject) => {
        let data = '';
        req.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        req.on('end', () => {
          try {
            resolve(data ? JSON.parse(data) : undefined);
          } catch (e) {
            reject(new Error('Invalid JSON body'));
          }
        });
        req.on('error', reject);
      });
    };

    const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      // Security: No CORS headers are set. This server binds to 127.0.0.1 by default
      // and is intended for direct MCP client communication (Claude, Cursor), not
      // browser-based access. Omitting Access-Control-Allow-Origin prevents arbitrary
      // websites from making cross-origin authenticated requests to this server,
      // which would otherwise allow any page open in the user's browser to trigger
      // Azure DevOps API calls using the configured PAT token.

      const url = new URL(req.url || '/', `http://${req.headers.host || `${host}:${port}`}`);

      // Health check endpoint
      if (url.pathname === '/health' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ok',
          transport: 'streamable-http',
          activeSessions: Object.keys(transports).length,
          configured: this.currentConfig !== null,
          organization: this.currentConfig?.organizationUrl || null,
          project: this.currentConfig?.project || null,
        }));
        return;
      }

      // Only serve MCP on /mcp
      if (url.pathname !== '/mcp') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not Found. MCP endpoint is at /mcp' }));
        return;
      }

      try {
        if (req.method === 'POST') {
          const body = await parseBody(req);
          const sessionId = req.headers['mcp-session-id'] as string | undefined;

          if (sessionId && transports[sessionId]) {
            // Existing session - route to its transport
            await transports[sessionId].handleRequest(req, res, body);
          } else if (!sessionId && isInitializeRequest(body)) {
            // New session initialization
            const transport = new StreamableHTTPServerTransport({
              sessionIdGenerator: () => randomUUID(),
              onsessioninitialized: (sid: string) => {
                console.error(`Session initialized: ${sid}`);
                transports[sid] = transport;
              }
            });

            transport.onclose = () => {
              const sid = transport.sessionId;
              if (sid && transports[sid]) {
                console.error(`Session closed: ${sid}`);
                delete transports[sid];
              }
            };

            // Each session gets its own MCP Server instance
            const mcpServer = this.createMCPServer();
            await mcpServer.connect(transport);
            await transport.handleRequest(req, res, body);
          } else {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              jsonrpc: '2.0',
              error: {
                code: -32000,
                message: 'Bad Request: No valid session ID provided, or not an initialization request',
              },
              id: null,
            }));
          }
        } else if (req.method === 'GET') {
          // SSE stream for server-to-client notifications
          const sessionId = req.headers['mcp-session-id'] as string | undefined;
          if (!sessionId || !transports[sessionId]) {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('Invalid or missing session ID');
            return;
          }
          await transports[sessionId].handleRequest(req, res);
        } else if (req.method === 'DELETE') {
          // Session termination
          const sessionId = req.headers['mcp-session-id'] as string | undefined;
          if (!sessionId || !transports[sessionId]) {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('Invalid or missing session ID');
            return;
          }
          await transports[sessionId].handleRequest(req, res);
        } else {
          res.writeHead(405, { 'Content-Type': 'text/plain' });
          res.end('Method Not Allowed');
        }
      } catch (error) {
        console.error('Error handling MCP request:', error);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32603, message: 'Internal server error' },
            id: null,
          }));
        }
      }
    });

    // Graceful shutdown
    const shutdown = async () => {
      console.error('\nShutting down...');
      for (const sessionId in transports) {
        try {
          await transports[sessionId].close();
          delete transports[sessionId];
        } catch (error) {
          console.error(`Error closing session ${sessionId}:`, error);
        }
      }
      httpServer.close();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    httpServer.listen(port, host, () => {
      console.error(`Azure DevOps MCP Server listening on http://${host}:${port}/mcp`);
      console.error(`Health check: http://${host}:${port}/health`);
      if (this.currentConfig) {
        console.error(`Connected to: ${this.currentConfig.organizationUrl} / ${this.currentConfig.project}`);
      } else {
        console.error('Warning: No Azure DevOps configuration loaded. Create a .azure-devops.json file.');
      }
    });
  }
}

async function main() {
  const { transport, port, host, configPath } = parseArgs();
  const proxy = new AzureDevOpsMCPProxy(configPath);

  if (transport === 'http') {
    await proxy.startHttp(port, host);
  } else {
    await proxy.startStdio();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
}

export { main, AzureDevOpsMCPProxy };