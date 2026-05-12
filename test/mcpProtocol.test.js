import test from "node:test";
import assert from "node:assert/strict";
import { createMcpHandler, getToolDefinition } from "../src/mcpProtocol.js";

test("tool definition describes the recipe recommender", () => {
  const tool = getToolDefinition();
  assert.equal(tool.name, "recommend_arla_recipes");
  assert.equal(tool.inputSchema.required[0], "query");
  assert.equal(tool.inputSchema.properties.limit.maximum, 5);
});

test("MCP handler supports initialize and tools/list", async () => {
  const handler = createMcpHandler({
    recipeService: {
      recommendRecipes: async () => ({ recipes: [], shopping_list: [], caveat: "", query: "" })
    }
  });

  const initialized = await handler({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  assert.equal(initialized.result.serverInfo.name, "arla-meal-finder");
  assert.match(initialized.result.instructions, /Arla\.dk/);

  const tools = await handler({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  assert.equal(tools.result.tools[0].name, "recommend_arla_recipes");
});

test("MCP handler calls recipe service", async () => {
  const handler = createMcpHandler({
    recipeService: {
      recommendRecipes: async (args) => ({
        query: args.query,
        source: { name: "test", sitemap_url: "https://www.arla.dk/sitemap.xml" },
        recipes: [
          {
            name: "Kylling i karry",
            url: "https://www.arla.dk/opskrifter/kylling-i-karry/",
            total_time_minutes: 45,
            recipe_yield: "4 personer",
            category: "Aftensmad",
            ingredients: ["Kylling", "Ris"],
            match_rationale: ["uses kylling"]
          }
        ],
        shopping_list: ["Kylling", "Ris"],
        caveat: "source caveat"
      })
    }
  });

  const response = await handler({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "recommend_arla_recipes",
      arguments: { query: "kylling" }
    }
  });

  assert.equal(response.result.structuredContent.recipes[0].name, "Kylling i karry");
  assert.match(response.result.content[0].text, /Shopping-list-style/);
});
