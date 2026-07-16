#!/usr/bin/env node

import http from "node:http";

const PORT = Number(process.env.PORT || 3001);

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    req.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    req.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }

      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });

    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method !== "POST" || req.url !== "/chat") {
      sendJson(res, 404, { success: false, error: "Not found" });
      return;
    }

    const payload = await readJsonBody(req);
    const message = typeof payload.message === "string" ? payload.message : "";
    const escalated = /\bagent\b/i.test(message);

    sendJson(res, 200, {
      success: true,
      escalated,
      messages: [
        {
          type: "text",
          text: escalated
            ? "AI reply: I understand you requested an agent. I am escalating this chat now."
            : `AI reply: ${message || "Hello! How can I help you today?"}`
        }
      ]
    });
  } catch (error) {
    sendJson(res, 400, {
      success: false,
      error: error instanceof Error ? error.message : "Bad request"
    });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Mock routing server listening on http://localhost:${PORT}`);
  console.log("POST /chat -> returns AI reply and escalated=true when message contains 'agent'");
});
