import { loadConfig } from "./config.js";
import { createMcpHandler } from "./mcpProtocol.js";
import { createRecipeService } from "./recipeService.js";
import { startHttpServer } from "./httpServer.js";
import { startStdioServer } from "./stdioServer.js";

const config = loadConfig();
const recipeService = createRecipeService(config);
const handleMcpRequest = createMcpHandler({ recipeService });

if (config.transport === "http") {
  startHttpServer({ config, handleMcpRequest });
} else if (config.transport === "stdio") {
  startStdioServer({ handleMcpRequest });
} else {
  throw new Error(`Unsupported MCP_TRANSPORT: ${config.transport}`);
}
