# Arla Meal Finder MCP

Small MCP pilot for Arla.dk consumer utility.

The MCP exposes one tool, `recommend_arla_recipes`, which searches public Arla.dk recipe pages and returns source-linked recipe suggestions plus a shopping-list-style ingredient summary.

## What It Does

- Reads the public Arla.dk recipe sitemap.
- Fetches a bounded set of recipe pages.
- Extracts structured `Recipe` JSON-LD.
- Scores recipes against a natural meal request, included/excluded ingredients, time, meal type, and soft dietary preference.
- Returns recipe titles, source URLs, time, servings, ingredients, nutrition summary when available, ratings, match rationale, and a combined ingredient list.

## Local Test

```powershell
node --test
node scripts/smoke-local.mjs
```

## Local HTTP Mode

```powershell
$env:MCP_TRANSPORT = "http"
$env:MCP_AUTH_TOKEN = "local-dev-token"
$env:PORT = "3017"
node src/index.js
```

Then post JSON-RPC requests to:

```text
http://127.0.0.1:3017/mcp
```

Use an `Authorization: Bearer local-dev-token` header.

## Deployment Readiness

The project includes a `Dockerfile` and `render.yaml`, but this pilot should not be deployed until the owner approves:

- hosting target,
- auth token handling,
- whether the endpoint can be public,
- whether ChatGPT testing should use bearer auth, OAuth, or a short diagnostic no-auth window.

The current `render.yaml` is set for an explicitly approved short-lived ChatGPT UI test with:

```text
ALLOW_UNAUTHENTICATED_HTTP=1
```

Remove that setting and use `MCP_AUTH_TOKEN` or OAuth before wider colleague testing.

## Safety Notes

- Public Arla.dk content only.
- No login, CRM, retailer checkout, or personal data.
- No live availability or basket accuracy claims.
- Nutrition/allergen fields are reported from source pages only and are not medical advice.
