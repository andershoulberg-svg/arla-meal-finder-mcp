import http from "node:http";
import crypto from "node:crypto";

export function startHttpServer({ config, handleMcpRequest }) {
  const rateBuckets = new Map();
  const sseSessions = new Map();

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === "OPTIONS") {
        sendOptions(res);
        return;
      }

      if (!passesRateLimit(req, config, rateBuckets)) {
        sendJson(res, 429, { error: "rate_limited" });
        return;
      }

      if (req.method === "GET" && req.url === "/health") {
        sendJson(res, 200, { ok: true, name: "arla-meal-finder" });
        return;
      }

      if (req.method === "GET" && req.url === "/") {
        sendJson(res, 200, {
          ok: true,
          name: "arla-meal-finder",
          mcp: "/mcp",
          tools: ["recommend_arla_recipes"]
        });
        return;
      }

      if (req.method === "GET" && req.url === "/mcp") {
        if (!isAuthorized(req, config)) {
          sendJson(res, 401, { error: "unauthorized" });
          return;
        }
        const sessionId = crypto.randomUUID();
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "Access-Control-Allow-Origin": "*"
        });
        sseSessions.set(sessionId, res);
        res.write(`event: endpoint\ndata: /mcp/message?sessionId=${sessionId}\n\n`);
        res.write(`: ready\n\n`);
        const heartbeat = setInterval(() => {
          if (!res.destroyed) res.write(`: ping\n\n`);
        }, 25000);
        req.on("close", () => {
          clearInterval(heartbeat);
          sseSessions.delete(sessionId);
        });
        return;
      }

      if (req.method === "POST" && req.url?.startsWith("/mcp/message")) {
        if (!isAuthorized(req, config)) {
          sendJson(res, 401, { error: "unauthorized" });
          return;
        }

        const requestUrl = new URL(req.url, "http://localhost");
        const sessionId = requestUrl.searchParams.get("sessionId");
        const sseResponse = sessionId ? sseSessions.get(sessionId) : null;
        if (!sseResponse || sseResponse.destroyed) {
          sendJson(res, 404, { error: "sse_session_not_found" });
          return;
        }

        const body = await readJsonBody(req);
        const response = await handleBody(body, handleMcpRequest);
        if (response !== null) {
          sseResponse.write(`event: message\ndata: ${JSON.stringify(response)}\n\n`);
        }
        sendJson(res, 202, { ok: true });
        return;
      }

      if (req.method === "POST" && req.url === "/mcp") {
        if (!isAuthorized(req, config)) {
          sendJson(res, 401, { error: "unauthorized" });
          return;
        }

        const body = await readJsonBody(req);
        const response = await handleBody(body, handleMcpRequest);
        if (response === null) {
          sendJson(res, 202, { ok: true });
        } else {
          sendJson(res, hasJsonRpcError(response) ? 400 : 200, response);
        }
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

async function handleBody(body, handleMcpRequest) {
  if (Array.isArray(body)) {
    const responses = [];
    for (const item of body) {
      const response = await handleMcpRequest(item);
      if (response !== null) responses.push(response);
    }
    return responses.length ? responses : null;
  }
  return handleMcpRequest(body);
}

function hasJsonRpcError(response) {
  if (Array.isArray(response)) return response.some((item) => item?.error);
  return Boolean(response?.error);
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
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type, authorization, mcp-session-id",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
  });
  res.end(JSON.stringify(payload));
}

function sendOptions(res) {
  res.writeHead(204, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type, authorization, mcp-session-id",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "86400"
  });
  res.end();
}
