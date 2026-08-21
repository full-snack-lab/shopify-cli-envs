import net from "node:net";
import tls from "node:tls";

interface Proxy {
  host: string;
  port: number;
  auth?: string;
}

function proxyFromEnv(): Proxy | undefined {
  const raw =
    process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.HTTP_PROXY ?? process.env.http_proxy;
  if (raw === undefined || raw === "") return undefined;
  const url = new URL(raw);
  const proxy: Proxy = { host: url.hostname, port: Number(url.port === "" ? 3128 : url.port) };
  if (url.username !== "") {
    proxy.auth = Buffer.from(`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`).toString(
      "base64",
    );
  }
  return proxy;
}

function connect(proxy: Proxy | undefined, host: string, port: number, timeoutMs: number): Promise<net.Socket> {
  if (proxy === undefined) {
    return new Promise((resolve, reject) => {
      const socket = net.connect(port, host);
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`connect to ${host}:${port} timed out`));
      }, timeoutMs);
      socket.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      socket.once("connect", () => {
        clearTimeout(timer);
        resolve(socket);
      });
    });
  }
  return new Promise((resolve, reject) => {
    const socket = net.connect(proxy.port, proxy.host);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`CONNECT ${host}:${port} through ${proxy.host}:${proxy.port} timed out`));
    }, timeoutMs);
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.once("connect", () => {
      const auth = proxy.auth === undefined ? "" : `Proxy-Authorization: Basic ${proxy.auth}\r\n`;
      socket.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n${auth}\r\n`);
    });
    let buffer = Buffer.alloc(0);
    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      socket.removeListener("data", onData);
      clearTimeout(timer);
      const statusLine = buffer.subarray(0, headerEnd).toString().split("\r\n")[0] ?? "";
      if (!/^HTTP\/1\.[01] 200/.test(statusLine)) {
        socket.destroy();
        reject(new Error(`proxy refused CONNECT ${host}:${port}: ${statusLine}`));
        return;
      }
      const leftover = buffer.subarray(headerEnd + 4);
      if (leftover.length > 0) socket.unshift(leftover);
      resolve(socket);
    };
    socket.on("data", onData);
  });
}

export interface HttpResponse {
  status: number;
  body: string;
}

export async function httpsRequest(
  url: string,
  options: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number } = {},
): Promise<HttpResponse> {
  const target = new URL(url);
  const port = Number(target.port === "" ? 443 : target.port);
  const timeoutMs = options.timeoutMs ?? 60000;
  const tcp = await connect(proxyFromEnv(), target.hostname, port, timeoutMs);
  const secure = tls.connect({ socket: tcp, servername: target.hostname });

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      secure.destroy();
      reject(new Error(`${options.method ?? "GET"} ${url} timed out`));
    }, timeoutMs);
    secure.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    secure.once("secureConnect", () => {
      const body = options.body ?? "";
      const headers = Object.entries({
        Host: target.hostname,
        "User-Agent": "shopify-cli-envs",
        Connection: "close",
        ...(body === "" ? {} : { "Content-Length": String(Buffer.byteLength(body)) }),
        ...options.headers,
      })
        .map(([name, value]) => `${name}: ${value}`)
        .join("\r\n");
      secure.write(
        `${options.method ?? "GET"} ${target.pathname}${target.search} HTTP/1.1\r\n${headers}\r\n\r\n${body}`,
      );
    });
    let buffer = Buffer.alloc(0);
    let settled = false;
    const finish = () => {
      if (settled) return;
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`${url} answered without headers`));
        return;
      }
      const head = buffer.subarray(0, headerEnd).toString();
      const statusLine = head.split("\r\n")[0] ?? "";
      const status = Number(statusLine.split(" ")[1] ?? "0");
      let body = buffer.subarray(headerEnd + 4);
      if (/transfer-encoding:\s*chunked/i.test(head)) {
        const parts: Buffer[] = [];
        let offset = 0;
        while (offset < body.length) {
          const lineEnd = body.indexOf("\r\n", offset);
          if (lineEnd === -1) break;
          const size = Number.parseInt(body.subarray(offset, lineEnd).toString(), 16);
          if (Number.isNaN(size) || size === 0) break;
          parts.push(body.subarray(lineEnd + 2, lineEnd + 2 + size));
          offset = lineEnd + 2 + size + 2;
        }
        body = Buffer.concat(parts);
      }
      settled = true;
      clearTimeout(timer);
      secure.destroy();
      resolve({ status, body: body.toString() });
    };
    const complete = (): boolean => {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return false;
      const head = buffer.subarray(0, headerEnd).toString();
      const lengthMatch = /content-length:\s*(\d+)/i.exec(head);
      if (lengthMatch !== null) {
        return buffer.length >= headerEnd + 4 + Number(lengthMatch[1]);
      }
      if (/transfer-encoding:\s*chunked/i.test(head)) {
        return buffer.includes("\r\n0\r\n", headerEnd);
      }
      return false;
    };
    secure.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (complete()) finish();
    });
    secure.on("end", finish);
  });
}
