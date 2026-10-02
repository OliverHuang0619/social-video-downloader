#!/usr/bin/env node
import http from "node:http";
import net from "node:net";
import { readFileSync } from "node:fs";

const listenHost = process.env.LOCAL_BROWSER_PROXY_HOST || "0.0.0.0";
const listenPort = Number(process.env.LOCAL_BROWSER_PROXY_PORT || 9223);
const chromePort = Number(process.env.LOCAL_BROWSER_CDP_PORT || 9222);
const token = readFileSync(process.env.LOCAL_BROWSER_TOKEN_FILE, "utf8").trim();

function authorized(request) {
  return request.headers.authorization === `Bearer ${token}`;
}

function reject(socketOrResponse) {
  if ("writeHead" in socketOrResponse) {
    socketOrResponse.writeHead(401, { "content-type": "text/plain", connection: "close" });
    socketOrResponse.end("Unauthorized");
  } else {
    socketOrResponse.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
  }
}

const server = http.createServer((request, response) => {
  if (!authorized(request)) return reject(response);
  const requestHeaders = { ...request.headers, host: `127.0.0.1:${chromePort}` };
  delete requestHeaders.authorization;
  const upstream = http.request({ hostname: "127.0.0.1", port: chromePort, path: request.url, method: request.method, headers: requestHeaders }, upstreamResponse => {
    const chunks = [];
    upstreamResponse.on("data", chunk => chunks.push(chunk));
    upstreamResponse.on("end", () => {
      let body = Buffer.concat(chunks);
      if (String(upstreamResponse.headers["content-type"] || "").includes("application/json")) {
        const publicHost = request.headers.host || `host.docker.internal:${listenPort}`;
        body = Buffer.from(body.toString("utf8").replaceAll(`ws://127.0.0.1:${chromePort}`, `ws://${publicHost}`).replaceAll(`ws://localhost:${chromePort}`, `ws://${publicHost}`));
      }
      response.writeHead(upstreamResponse.statusCode || 502, { ...upstreamResponse.headers, "content-length": body.length });
      response.end(body);
    });
  });
  upstream.on("error", () => { response.writeHead(502); response.end("Chrome CDP unavailable"); });
  request.pipe(upstream);
});

server.on("upgrade", (request, socket, head) => {
  if (!authorized(request)) return reject(socket);
  const upstream = net.connect(chromePort, "127.0.0.1", () => {
    const headers = Object.entries(request.headers)
      .filter(([name]) => name.toLowerCase() !== "authorization")
      .map(([name, value]) => `${name}: ${Array.isArray(value) ? value.join(", ") : value}`);
    const hostIndex = headers.findIndex(line => line.toLowerCase().startsWith("host:"));
    const host = `Host: 127.0.0.1:${chromePort}`;
    if (hostIndex >= 0) headers[hostIndex] = host; else headers.push(host);
    upstream.write(`${request.method} ${request.url} HTTP/${request.httpVersion}\r\n${headers.join("\r\n")}\r\n\r\n`);
    if (head.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on("error", () => socket.destroy());
});

server.listen(listenPort, listenHost, () => process.stdout.write(`Local browser proxy: http://${listenHost}:${listenPort}\n`));
