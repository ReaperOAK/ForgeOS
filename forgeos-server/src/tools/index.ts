// forgeos-server/src/tools/index.ts
// Registers all MCP tools for the ForgeOS server

export function registerTools(server) {
  server.registerTool({
    name: 'tickets.next',
    description: 'Find next available ticket for a given SDLC stage (peek, not claim)',
    inputSchema: ticketsNextInputSchema,
    handler: ticketsNext,
  });
  // ...register other tools here...
}
