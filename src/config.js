export function loadConfig(env = process.env) {
  const transport = (env.MCP_TRANSPORT || "stdio").toLowerCase();
  const allowUnauthenticatedHttp = env.ALLOW_UNAUTHENTICATED_HTTP === "1";
  const authToken = env.MCP_AUTH_TOKEN || "";

  if (transport === "http" && !allowUnauthenticatedHttp && !authToken) {
    throw new Error(
      "MCP_AUTH_TOKEN is required in HTTP mode unless ALLOW_UNAUTHENTICATED_HTTP=1 is explicitly set."
    );
  }

  return {
    transport,
    host: env.MCP_HOST || "127.0.0.1",
    port: Number(env.PORT || env.MCP_PORT || 3017),
    authToken,
    allowUnauthenticatedHttp,
    rateLimitPerMinute: Number(env.MCP_RATE_LIMIT_PER_MINUTE || 60),
    arlaRecipeSitemapUrl:
      env.ARLA_RECIPE_SITEMAP_URL ||
      "https://www.arla.dk/sitemap.xml?type=Modules.Recipes.Business.SitemapUrlWriter.RecipeSitemapUrlWriter",
    fetchTimeoutMs: Number(env.ARLA_FETCH_TIMEOUT_MS || 12000),
    candidateFetchLimit: Number(env.ARLA_CANDIDATE_FETCH_LIMIT || 18)
  };
}
