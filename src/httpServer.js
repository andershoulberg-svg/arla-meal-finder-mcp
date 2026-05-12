import http from "node:http";

export function startHttpServer({ config, handleMcpRequest }) {
  const rateBuckets = new Map();

  const server = http.createServer(async (req, res) => {
    try {
      if (!passesRateLimit(req, config, rateBuckets)) {
        sendJson(res, 429, { error: "rate_limited" });
        return;
      }

      if (req.method === "GET" && req.url === "/health") {
        sendJson(res, 200, { ok: true, name: "arla-meal-finder" });
        return;
      }

      if (req.method === "GET" && req.url === "/mcp") {
        if (!isAuthorized(req, config)) {
          sendJson(res, 401, { error: "unauthorized" });
          return;
        }
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive"
        });
        res.write(`event: endpoint\ndata: ${JSON.stringify({ endpoint: "/mcp" })}\n\n`);
        res.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`);
        return;
      }

      if (req.method === "POST" && req.url === "/mcp") {
        if (!isAuthorized(req, config)) {
          sendJson(res, 401, { error: "unauthorized" });
          return;
        }

        const body = await readJsonBody(req);
        const response = await handleMcpRequest(body);
        sendJson(res, response.error ? 400 : 200, response);
        return;
      }

      sendJson(res, 404, { error: "not_found" });
    } catch (error) {
      sendJson(res, 500, { error: "internal_error", message: error.message });
    }
  });

  server.listen(config.port, config.host, () => {
    const address = server.address();
    const port = typeof address === "object" ? address.port : config.port;
    console.log(`Arla Meal Finder MCP listening on http://${config.host}:${port}`);
  });

  return server;
}

function isAuthorized(req, config) {
  if (config.allowUnauthenticatedHttp) return true;
  const expected = `Bearer ${config.authToken}`;
  return req.headers.authorization === expected;
}

function passesRateLimit(req, config, buckets) {
  const key = req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const windowMs = 60_000;
  const bucket = buckets.get(key) || { start: now, count: 0 };

  if (now - bucket.start > windowMs) {
    bucket.start = now;
    bucket.count = 0;
  }

  bucket.count += 1;
  buckets.set(key, bucket);
  return bucket.count <= config.rateLimitPerMinute;
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  res.end(JSON.stringify(payload));
}
