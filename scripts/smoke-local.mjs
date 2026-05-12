import { spawn } from "node:child_process";

const port = Number(process.env.SMOKE_PORT || 43177);
const token = "local-smoke-token";
const baseUrl = `http://127.0.0.1:${port}`;

const child = spawn(process.execPath, ["src/index.js"], {
  cwd: new URL("..", import.meta.url),
  env: {
    ...process.env,
    MCP_TRANSPORT: "http",
    MCP_HOST: "127.0.0.1",
    PORT: String(port),
    MCP_AUTH_TOKEN: token,
    ARLA_CANDIDATE_FETCH_LIMIT: "10"
  },
  stdio: ["ignore", "pipe", "pipe"]
});

let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => {
  stdout += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});

try {
  await waitForHealth();

  const unauthorized = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "ping" })
  });
  assert(unauthorized.status === 401, "unauthorized request should fail");

  const initialized = await postMcp({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  assert(initialized.result?.serverInfo?.name === "arla-meal-finder", "initialize should return server info");

  const tools = await postMcp({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  assert(tools.result?.tools?.[0]?.name === "recommend_arla_recipes", "tools/list should expose tool");

  const call = await postMcp({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "recommend_arla_recipes",
      arguments: {
        query: "nem aftensmad med kylling og ris",
        meal_type: "aftensmad",
        include_ingredients: ["kylling", "ris"],
        max_total_time_minutes: 60,
        limit: 2
      }
    }
  });
  assert(call.result?.structuredContent?.recipes?.length > 0, "tools/call should return recipes");
  assert(
    call.result.structuredContent.recipes.every((recipe) => recipe.url?.startsWith("https://www.arla.dk/")),
    "recipes should include Arla.dk source URLs"
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        checks: ["health", "unauthorized", "initialize", "tools/list", "tools/call"],
        sample_recipe: call.result.structuredContent.recipes[0].name,
        sample_url: call.result.structuredContent.recipes[0].url
      },
      null,
      2
    )
  );
} finally {
  child.kill();
}

async function waitForHealth() {
  const started = Date.now();
  while (Date.now() - started < 15000) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`server did not become healthy. stdout=${stdout} stderr=${stderr}`);
}

async function postMcp(payload) {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });
  const json = await response.json();
  if (!response.ok || json.error) {
    throw new Error(`MCP request failed: ${JSON.stringify(json)}`);
  }
  return json;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
