import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

/** Creates the stdio MCP server, registers the package's tools, and connects. */
export async function runStdioServer(
  serverInfo: { name: string; version: string },
  configure: (server: McpServer) => void
): Promise<void> {
  const server = new McpServer(serverInfo, {
    capabilities: {
      tools: {},
    },
  });
  configure(server);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`${serverInfo.name} MCP Server running on stdio`);
}
