import 'dotenv/config';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createAssessCraftMcpServer } from './createMcpServer.ts';

process.env.ASSESSCRAFT_STDIO_MODE = '1';

async function main() {
  const server = createAssessCraftMcpServer({
    localOAuthFallback: true,
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('AssessCraft Universal MCP Server running on stdio');
}

main().catch((err) => {
  console.error('Fatal MCP stdio error:', err);
  process.exit(1);
});
