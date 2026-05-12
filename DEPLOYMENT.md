# Deployment And ChatGPT Test Path

This MCP is ready for a hosted pilot, but publishing needs owner approval because it creates a public HTTPS endpoint.

## Recommended Hosting Path

1. Push `mcp-arla-meal-finder/` to a GitHub repository.
2. Create a Render Web Service from the repo.
3. Use Docker runtime with the included `Dockerfile`.
4. Set Render health check path to `/health`.
5. Configure environment variables:

```text
MCP_TRANSPORT=http
MCP_HOST=0.0.0.0
MCP_AUTH_TOKEN=<long random token>
MCP_RATE_LIMIT_PER_MINUTE=60
ARLA_FETCH_TIMEOUT_MS=12000
ARLA_CANDIDATE_FETCH_LIMIT=18
```

Do not set `MCP_PORT`; Render provides `PORT`.

## Remote Smoke Test

After deployment:

```powershell
$env:MCP_SERVER_URL = "https://<host>/mcp"
$env:MCP_AUTH_TOKEN = "<token>"
$env:MCP_TOOL_NAME = "recommend_arla_recipes"
$env:MCP_TOOL_ARGUMENTS_JSON = '{"query":"nem aftensmad med kylling og ris","meal_type":"aftensmad","include_ingredients":["kylling","ris"],"max_total_time_minutes":60,"limit":2}'
node C:\Users\anders.houlberg\.codex\skills\deep-audit-tools\mcp-from-website\scripts\smoke-http-mcp.mjs
```

Never print bearer tokens in chat.

## ChatGPT Developer Mode Test

1. Add or reconnect the MCP endpoint:

```text
https://<host>/mcp
```

2. Use bearer auth if ChatGPT accepts it for the connector.
3. If ChatGPT cannot discover tools with bearer auth, use a short diagnostic no-auth window only after explicit approval:

```text
ALLOW_UNAUTHENTICATED_HTTP=1
```

Then remove the no-auth setting or move to OAuth before wider testing.

## Natural Prompt To Test

```text
Find three Arla recipes for a quick family dinner with chicken and rice, around 30-45 minutes, and make a shopping list for 4 people.
```

Expected behavior:

- ChatGPT calls `recommend_arla_recipes`.
- The MCP returns 2-3 source-linked Arla.dk recipe matches.
- ChatGPT summarizes recipe options and the shopping-list-style ingredients.
- ChatGPT does not claim live product availability or completed checkout.
