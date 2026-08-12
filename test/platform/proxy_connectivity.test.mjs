import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import test from "node:test";

import { testProxyConnectivity } from "../../src/platform/proxy_connectivity.mjs";

function listen(server, host = "127.0.0.1", port = 0) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve(server.address());
    });
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function createHttpIpServer() {
  const server = http.createServer((req, res) => {
    const body = JSON.stringify({ ip: "203.0.113.9", path: req.url });
    res.writeHead(200, {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(body),
      connection: "close",
    });
    res.end(body);
  });
  const address = await listen(server);
  return { server, url: `http://127.0.0.1:${address.port}/ip` };
}

async function createHttpProxy(counter) {
  const server = http.createServer((req, res) => {
    counter.count += 1;
    const target = new URL(req.url);
    const upstream = http.request({
      host: target.hostname,
      port: Number(target.port || 80),
      path: `${target.pathname}${target.search}`,
      method: req.method,
      headers: { accept: req.headers.accept || "*/*", connection: "close" },
    }, (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    });
    upstream.once("error", (error) => {
      res.writeHead(502, { "content-type": "text/plain" });
      res.end(String(error.message || error));
    });
    req.pipe(upstream);
  });
  server.on("connect", (req, clientSocket, head) => {
    counter.count += 1;
    const [host, port] = String(req.url).split(":");
    const upstream = net.connect(Number(port), host, () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.once("error", () => clientSocket.destroy());
  });
  const address = await listen(server);
  return { server, url: `http://127.0.0.1:${address.port}` };
}

async function createSocks5Proxy(counter) {
  const server = net.createServer((client) => {
    let stage = "greeting";
    let upstream = null;
    client.on("data", (chunk) => {
      if (stage === "greeting") {
        client.write(Buffer.from([0x05, 0x00]));
        stage = "connect";
        return;
      }
      if (stage !== "connect") return;
      counter.count += 1;
      const atyp = chunk[3];
      let offset = 4;
      let host = "";
      if (atyp === 0x03) {
        const len = chunk[offset];
        offset += 1;
        host = chunk.subarray(offset, offset + len).toString("utf8");
        offset += len;
      } else if (atyp === 0x01) {
        host = Array.from(chunk.subarray(offset, offset + 4)).join(".");
        offset += 4;
      } else {
        client.destroy();
        return;
      }
      const port = chunk.readUInt16BE(offset);
      upstream = net.connect(port, host, () => {
        client.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 127, 0, 0, 1, 0, 0]));
        upstream.pipe(client);
        client.pipe(upstream);
      });
      upstream.once("error", () => client.destroy());
      stage = "pipe";
    });
    client.once("close", () => upstream?.destroy());
  });
  const address = await listen(server);
  return { server, url: `socks5://127.0.0.1:${address.port}` };
}

test("proxy connectivity test reaches target through HTTP proxy", async () => {
  const target = await createHttpIpServer();
  const counter = { count: 0 };
  const proxy = await createHttpProxy(counter);
  try {
    const result = await testProxyConnectivity(proxy.url, {
      test_url: target.url,
      timeout_ms: 5000,
    });
    assert.equal(result.ok, true);
    assert.equal(result.ip, "203.0.113.9");
    assert.equal(counter.count, 1);
  } finally {
    await close(proxy.server);
    await close(target.server);
  }
});

test("proxy connectivity test reaches target through SOCKS5 proxy", async () => {
  const target = await createHttpIpServer();
  const counter = { count: 0 };
  const proxy = await createSocks5Proxy(counter);
  try {
    const result = await testProxyConnectivity(proxy.url, {
      test_url: target.url,
      timeout_ms: 5000,
    });
    assert.equal(result.ok, true);
    assert.equal(result.ip, "203.0.113.9");
    assert.equal(counter.count, 1);
  } finally {
    await close(proxy.server);
    await close(target.server);
  }
});
