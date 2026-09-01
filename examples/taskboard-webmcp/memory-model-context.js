/**
 * Test-only WebMCP surface: it preserves the browser draft's register, list,
 * and execute boundaries while keeping all data in memory. The page demo uses
 * the real document.modelContext instead.
 */
export function createMemoryModelContext(origin = 'https://taskboard.example.test') {
  /** @type {Map<string, import('../../packages/runtime/src/webmcp.js').WebMcpToolDefinition>} */
  const definitions = new Map();
  let getToolsCalls = 0;
  return Object.freeze({
    async registerTool(tool) {
      definitions.set(tool.name, tool);
    },
    async getTools() {
      getToolsCalls += 1;
      return [...definitions.values()].map((tool) => ({
        annotations: tool.annotations,
        description: tool.description,
        inputSchema: tool.inputSchema,
        name: tool.name,
        origin,
        title: tool.title,
      }));
    },
    async executeTool(tool, input = {}, options = {}) {
      const definition = definitions.get(tool.name);
      if (definition === undefined) throw new Error(`Unknown WebMCP tool: ${tool.name}`);
      const output = await definition.execute(input, { signal: options.signal });
      return JSON.stringify(output);
    },
    getToolsCallCount: () => getToolsCalls,
    registeredNames: () => [...definitions.keys()].sort(),
  });
}
