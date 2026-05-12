const TOOL_NAME = "recommend_arla_recipes";

export function getToolDefinition() {
  return {
    name: TOOL_NAME,
    title: "Recommend Arla.dk recipes",
    description:
      "Use this tool when the user asks for Arla recipe ideas, Danish meal inspiration, pantry-to-recipe help, quick dinner ideas, family meal planning, or a shopping-list-style summary. Extract natural wording into query, time, servings, meal type, included ingredients, excluded ingredients, and soft dietary preferences. Do not use it for medical advice, live retailer availability, or checkout.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: {
          type: "string",
          minLength: 2,
          description:
            "Natural meal request, for example 'quick family dinner with chicken and rice' or 'nem aftensmad med kylling og ris'."
        },
        servings: {
          type: "integer",
          minimum: 1,
          maximum: 12,
          description: "Desired number of people. Used for context; source recipe quantities are preserved."
        },
        max_total_time_minutes: {
          type: "integer",
          minimum: 5,
          maximum: 600,
          description: "Maximum total cooking time in minutes."
        },
        meal_type: {
          type: "string",
          description:
            "Soft meal type filter such as aftensmad, frokost, morgenmad, dessert, brunch, snack."
        },
        include_ingredients: {
          type: "array",
          items: { type: "string" },
          description: "Ingredients the user wants to use."
        },
        exclude_ingredients: {
          type: "array",
          items: { type: "string" },
          description: "Ingredients the user wants to avoid."
        },
        dietary_preference: {
          type: "string",
          description:
            "Soft preference such as laktosefri, vegetarisk, proteinrig. This is not medical advice."
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 5,
          default: 3,
          description: "Number of recipes to return."
        }
      }
    }
  };
}

export function createMcpHandler({ recipeService }) {
  return async function handleMcpRequest(request) {
    if (!request || typeof request !== "object") {
      return jsonRpcError(null, -32600, "Invalid Request");
    }

    const { id = null, method, params } = request;

    try {
      if (method === "initialize") {
        return jsonRpcResult(id, {
          protocolVersion: "2024-11-05",
          capabilities: {
            tools: {}
          },
          serverInfo: {
            name: "arla-meal-finder",
            version: "0.1.0"
          },
          instructions:
            "This MCP helps with Arla.dk meal inspiration from public recipe pages. Users can ask naturally for quick dinners, ingredients they have, serving size, meal type, or soft preferences. Always keep outputs grounded in returned Arla.dk source URLs. Do not claim live retailer availability, checkout completion, or medical advice."
        });
      }

      if (method === "ping") {
        return jsonRpcResult(id, {});
      }

      if (method === "tools/list") {
        return jsonRpcResult(id, {
          tools: [getToolDefinition()]
        });
      }

      if (method === "tools/call") {
        const name = params?.name;
        const args = params?.arguments || {};

        if (name !== TOOL_NAME) {
          return jsonRpcError(id, -32602, `Unknown tool: ${name}`);
        }

        const result = await recipeService.recommendRecipes(args);
        return jsonRpcResult(id, {
          content: [
            {
              type: "text",
              text: formatToolText(result)
            }
          ],
          structuredContent: result
        });
      }

      return jsonRpcError(id, -32601, `Method not found: ${method}`);
    } catch (error) {
      return jsonRpcError(id, -32000, error.message || "Internal error");
    }
  };
}

function jsonRpcResult(id, result) {
  return {
    jsonrpc: "2.0",
    id,
    result
  };
}

function jsonRpcError(id, code, message) {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message
    }
  };
}

function formatToolText(result) {
  const lines = [
    `Found ${result.recipes.length} Arla.dk recipe match(es) for: ${result.query}`,
    ""
  ];

  for (const [index, recipe] of result.recipes.entries()) {
    lines.push(`${index + 1}. ${recipe.name}`);
    lines.push(`   URL: ${recipe.url}`);
    if (recipe.total_time_minutes) lines.push(`   Time: ${recipe.total_time_minutes} min`);
    if (recipe.recipe_yield) lines.push(`   Servings: ${recipe.recipe_yield}`);
    if (recipe.category) lines.push(`   Category: ${recipe.category}`);
    if (recipe.rating) {
      lines.push(`   Rating: ${recipe.rating.rating_value} (${recipe.rating.rating_count} ratings)`);
    }
    lines.push(`   Why it matched: ${recipe.match_rationale.join("; ")}`);
    lines.push(`   Key ingredients: ${recipe.ingredients.slice(0, 8).join(", ")}`);
    lines.push("");
  }

  if (result.shopping_list.length) {
    lines.push("Shopping-list-style ingredient summary:");
    for (const item of result.shopping_list.slice(0, 30)) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }

  lines.push(result.caveat);
  return lines.join("\n");
}
