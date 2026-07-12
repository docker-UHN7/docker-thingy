import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import * as https from "node:https";
import type { IncomingMessage, ServerResponse } from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { NetworkActionRequestSchema } from "../shared/network-contracts";
import type { DetectedAddress, RemoteAccessStatus } from "../shared/remote-access-contracts";
import { execCommand, PROCESS_LIMITS } from "./process-runner";
import type { ProjectService } from "./project-service";
import { getNetworkTopology } from "./topology-service";
import { runNetworkAction } from "./network-control-service";
import { searchDockerHub } from "./docker-hub-service";
import { checkImageUpdate } from "./image-update-service";

// This exposes the same operations the desktop app performs (project/
// container control, network topology control - including toggling VM/
// container network isolation) over the network instead of Electron's
// same-process IPC. Off by default, token-gated, TLS-only. Its own on/off/
// rotate controls (enable/disable/regenerate/status below) are deliberately
// never reachable through the HTTP surface this module serves - only via
// local Electron IPC (wired in ipc.ts) - so a leaked token can't be used to
// re-enable itself, change its port, or read/rotate its own token.

const TOKEN_BYTES = 24;
const MAX_BODY_BYTES = 1024 * 1024;
const HEARTBEAT_MS = 25_000;

const STATIC_FILES: Record<string, { file: string; contentType: string }> = {
  "/main_window/index.js": { file: "index.js", contentType: "application/javascript; charset=utf-8" },
  "/main_window/index.js.map": { file: "index.js.map", contentType: "application/json; charset=utf-8" }
};

let server: https.Server | null = null;
let currentToken: string | null = null;
let currentPort: number | null = null;
let currentHost: string | null = null;
let unsubscribeSnapshots: (() => void) | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
const sseClients = new Set<ServerResponse>();

function rendererDir(): string {
  // Mirrors electron-forge's own packaged-mode resolution of
  // MAIN_WINDOW_WEBPACK_ENTRY (file://.../renderer/main_window/index.html)
  // relative to the main bundle's own __dirname (.webpack/main/ in both dev
  // and packaged layouts) - works without depending on the webpack dev
  // server, which this standalone HTTP(S) server never talks to.
  const compiledCandidate = path.resolve(__dirname, "..", "renderer", "main_window");
  if (fs.existsSync(compiledCandidate)) {
    return compiledCandidate;
  }

  // Loaded directly from src/main/ (e.g. under vitest) rather than the
  // compiled .webpack/main/ bundle - resolve the build output relative to
  // the repo root instead.
  return path.resolve(__dirname, "..", "..", ".webpack", "renderer", "main_window");
}

function certDir(dataDir: string): string {
  return path.join(dataDir, "remote-access");
}

async function ensureTlsCredentials(dataDir: string): Promise<{ cert: string; key: string }> {
  const dir = certDir(dataDir);
  const certPath = path.join(dir, "cert.pem");
  const keyPath = path.join(dir, "key.pem");

  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    return {
      cert: await fsPromises.readFile(certPath, "utf8"),
      key: await fsPromises.readFile(keyPath, "utf8")
    };
  }

  await fsPromises.mkdir(dir, { recursive: true });
  await execCommand(
    "openssl",
    ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", keyPath, "-out", certPath, "-days", "825", "-subj", "/CN=docker-thingy"],
    { timeoutMs: PROCESS_LIMITS.tlsCertGenerationMs, maxBytes: PROCESS_LIMITS.maxDiagnosticBytes, category: "tls-cert-generation" }
  );

  return {
    cert: await fsPromises.readFile(certPath, "utf8"),
    key: await fsPromises.readFile(keyPath, "utf8")
  };
}

function generateToken(): string {
  return crypto.randomBytes(TOKEN_BYTES).toString("hex");
}

// All non-internal IPv4 addresses this machine has, tagged with the
// interface name they're bound to (e.g. "eth0", "wlan0", "tailscale0") so the
// UI can tell a plain LAN address apart from a Tailscale/VPN one instead of
// guessing - some environments (a Tailscale-only server, a box with only a
// public IP behind a port-forward) have no single "right" answer.
function listCandidateAddresses(): DetectedAddress[] {
  const interfaces = os.networkInterfaces();
  const candidates: DetectedAddress[] = [];
  for (const [interfaceName, entries] of Object.entries(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) {
        candidates.push({ interfaceName, address: entry.address });
      }
    }
  }
  return candidates;
}

function pickDefaultAddress(): string {
  const [first] = listCandidateAddresses();
  return first?.address ?? os.hostname();
}

function statusFromState(): RemoteAccessStatus {
  const detectedAddresses = listCandidateAddresses();

  if (!server || !currentToken || currentPort === null || !currentHost) {
    return { enabled: false, detectedAddresses };
  }

  return {
    enabled: true,
    port: currentPort,
    host: currentHost,
    url: `https://${currentHost}:${currentPort}/?token=${currentToken}`,
    token: currentToken,
    detectedAddresses
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];

    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request body too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      if (chunks.length === 0) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });

    req.on("error", reject);
  });
}

function extractToken(req: IncomingMessage, url: URL): string | null {
  const header = req.headers.authorization;
  if (typeof header === "string" && header.startsWith("Bearer ")) {
    return header.slice("Bearer ".length);
  }
  return url.searchParams.get("token");
}

function isAuthorized(req: IncomingMessage, url: URL): boolean {
  if (!currentToken) {
    return false;
  }

  const provided = extractToken(req, url);
  if (!provided) {
    return false;
  }

  const providedBuf = Buffer.from(provided);
  const tokenBuf = Buffer.from(currentToken);
  if (providedBuf.length !== tokenBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(providedBuf, tokenBuf);
}

function broadcastSse(event: "build" | "snapshot", data: unknown): void {
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    client.write(frame);
  }
}

async function routeApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  projectService: ProjectService
): Promise<void> {
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };

  if (url.pathname === "/api/snapshot" && req.method === "GET") {
    send(200, await projectService.getSnapshot());
    return;
  }

  if (url.pathname === "/api/service-logs" && req.method === "POST") {
    const body = await readJsonBody(req);
    const containerId = isRecord(body) ? body.containerId : undefined;
    const tail = isRecord(body) ? body.tail : undefined;
    if (typeof containerId !== "string" || typeof tail !== "number") {
      send(400, { message: "Invalid service-logs request." });
      return;
    }
    send(200, await projectService.getServiceLogs(containerId, tail));
    return;
  }

  if (url.pathname === "/api/service-stats" && req.method === "POST") {
    const body = await readJsonBody(req);
    const containerId = isRecord(body) ? body.containerId : undefined;
    if (typeof containerId !== "string") {
      send(400, { message: "Invalid service-stats request." });
      return;
    }
    send(200, await projectService.getServiceStats(containerId));
    return;
  }

  if (url.pathname === "/api/settings" && req.method === "POST") {
    const body = await readJsonBody(req);
    send(200, await projectService.updateSettings(isRecord(body) ? body : {}));
    return;
  }

  if (url.pathname === "/api/clear-recents" && req.method === "POST") {
    send(200, await projectService.clearRecents());
    return;
  }

  if (url.pathname === "/api/project-config-files" && req.method === "POST") {
    const body = await readJsonBody(req);
    const projectId = isRecord(body) ? body.projectId : undefined;
    const configFiles = isRecord(body) ? body.configFiles : undefined;
    if (
      typeof projectId !== "string" ||
      !Array.isArray(configFiles) ||
      !configFiles.every((entry) => typeof entry === "string")
    ) {
      send(400, { message: "Invalid project-config-files request." });
      return;
    }
    send(200, await projectService.updateProjectConfigFiles(projectId, configFiles));
    return;
  }

  if (url.pathname === "/api/read-source-file" && req.method === "POST") {
    const body = await readJsonBody(req);
    const projectId = isRecord(body) ? body.projectId : undefined;
    const filePath = isRecord(body) ? body.filePath : undefined;
    if (typeof projectId !== "string" || typeof filePath !== "string") {
      send(400, { message: "Invalid read-source-file request." });
      return;
    }
    send(200, await projectService.readSourceFile(projectId, filePath));
    return;
  }

  if (url.pathname === "/api/save-source-file" && req.method === "POST") {
    const body = await readJsonBody(req);
    const projectId = isRecord(body) ? body.projectId : undefined;
    const filePath = isRecord(body) ? body.filePath : undefined;
    const sourceText = isRecord(body) ? body.sourceText : undefined;
    const expectedHash = isRecord(body) ? body.expectedHash : undefined;
    if (
      typeof projectId !== "string" ||
      typeof filePath !== "string" ||
      typeof sourceText !== "string" ||
      typeof expectedHash !== "string"
    ) {
      send(400, { message: "Invalid save-source-file request." });
      return;
    }
    send(200, await projectService.saveSourceFile(projectId, filePath, sourceText, expectedHash));
    return;
  }

  if (url.pathname === "/api/config-drift" && req.method === "POST") {
    const body = await readJsonBody(req);
    const projectId = isRecord(body) ? body.projectId : undefined;
    if (typeof projectId !== "string") {
      send(400, { message: "Invalid config-drift request." });
      return;
    }
    send(200, await projectService.getConfigDrift(projectId));
    return;
  }

  if (url.pathname === "/api/check-image-update" && req.method === "POST") {
    const body = await readJsonBody(req);
    const image = isRecord(body) ? body.image : undefined;
    if (typeof image !== "string" || image.trim() === "") {
      send(200, { ok: false, error: { code: "VALIDATION_FAILED", message: "Invalid image reference." } });
      return;
    }
    const info = await checkImageUpdate(image);
    send(200, { ok: true, data: { info } });
    return;
  }

  if (url.pathname === "/api/search-docker-hub" && req.method === "POST") {
    const body = await readJsonBody(req);
    const query = isRecord(body) ? body.query : undefined;
    if (typeof query !== "string") {
      send(200, { ok: false, error: { code: "VALIDATION_FAILED", message: "Invalid search query." } });
      return;
    }
    const results = await searchDockerHub(query);
    send(200, { ok: true, data: { results } });
    return;
  }

  if (url.pathname === "/api/add-service" && req.method === "POST") {
    const body = await readJsonBody(req);
    const projectId = isRecord(body) ? body.projectId : undefined;
    const input = isRecord(body) ? body.input : undefined;
    if (typeof projectId !== "string" || !isRecord(input)) {
      send(200, { ok: false, error: { code: "VALIDATION_FAILED", message: "Invalid add-service request." } });
      return;
    }
    send(200, await projectService.addServiceToProject(projectId, input as Parameters<typeof projectService.addServiceToProject>[1]));
    return;
  }

  if (url.pathname === "/api/remove-service" && req.method === "POST") {
    const body = await readJsonBody(req);
    const projectId = isRecord(body) ? body.projectId : undefined;
    const serviceName = isRecord(body) ? body.serviceName : undefined;
    if (typeof projectId !== "string" || typeof serviceName !== "string") {
      send(200, { ok: false, error: { code: "VALIDATION_FAILED", message: "Invalid remove-service request." } });
      return;
    }
    send(200, await projectService.removeServiceFromProject(projectId, serviceName));
    return;
  }

  if (url.pathname === "/api/project-action" && req.method === "POST") {
    const body = await readJsonBody(req);
    const projectId = isRecord(body) ? body.projectId : undefined;
    const actionId = isRecord(body) ? body.actionId : undefined;
    if (typeof projectId !== "string" || typeof actionId !== "string") {
      send(200, { ok: false, error: { code: "VALIDATION_FAILED", message: "Invalid project action request." } });
      return;
    }
    const result = await projectService.runProjectAction(projectId, actionId, (event) => broadcastSse("build", event));
    send(200, result);
    return;
  }

  if (url.pathname === "/api/network-topology" && req.method === "GET") {
    try {
      send(200, { ok: true, data: await getNetworkTopology() });
    } catch (error) {
      send(200, {
        ok: false,
        error: { code: "PROCESS_FAILED", message: error instanceof Error ? error.message : "Failed to load network topology." }
      });
    }
    return;
  }

  if (url.pathname === "/api/network-action" && req.method === "POST") {
    const body = await readJsonBody(req);
    const parsed = NetworkActionRequestSchema.safeParse(body);
    if (!parsed.success) {
      send(200, { ok: false, error: { code: "VALIDATION_FAILED", message: "Invalid network action request." } });
      return;
    }
    send(200, await runNetworkAction(parsed.data));
    return;
  }

  if (url.pathname === "/api/events" && req.method === "GET") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    });
    res.write(": connected\n\n");
    sseClients.add(res);
    req.on("close", () => {
      sseClients.delete(res);
    });
    return;
  }

  res.writeHead(404);
  res.end();
}

async function handleRequest(req: IncomingMessage, res: ServerResponse, projectService: ProjectService): Promise<void> {
  const url = new URL(req.url ?? "/", "http://internal");

  const staticEntry = STATIC_FILES[url.pathname];
  if (staticEntry && req.method === "GET") {
    try {
      const contents = await fsPromises.readFile(path.join(rendererDir(), staticEntry.file));
      res.writeHead(200, { "Content-Type": staticEntry.contentType });
      res.end(contents);
    } catch {
      res.writeHead(404);
      res.end();
    }
    return;
  }

  if (url.pathname === "/" && req.method === "GET") {
    if (!isAuthorized(req, url)) {
      res.writeHead(401, { "Content-Type": "text/plain" });
      res.end("Unauthorized");
      return;
    }
    try {
      const contents = await fsPromises.readFile(path.join(rendererDir(), "index.html"));
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(contents);
    } catch {
      res.writeHead(500);
      res.end("Renderer bundle not found - build the app first.");
    }
    return;
  }

  if (!url.pathname.startsWith("/api/")) {
    res.writeHead(404);
    res.end();
    return;
  }

  if (!isAuthorized(req, url)) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "Invalid or missing access token." }));
    return;
  }

  try {
    await routeApi(req, res, url, projectService);
  } catch (error) {
    if (!res.headersSent) {
      const tooLarge = error instanceof Error && error.message === "Request body too large.";
      res.writeHead(tooLarge ? 413 : 400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: error instanceof Error ? error.message : "Request failed." }));
    }
  }
}

function stopRemoteAccessInternal(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  unsubscribeSnapshots?.();
  unsubscribeSnapshots = null;
  for (const client of sseClients) {
    client.end();
  }
  sseClients.clear();
  server?.close();
  server = null;
  currentPort = null;
  currentToken = null;
  currentHost = null;
}

export function getRemoteAccessStatus(): RemoteAccessStatus {
  return statusFromState();
}

export async function enableRemoteAccess(
  port: number,
  projectService: ProjectService,
  host: string | undefined,
  dataDir: string
): Promise<RemoteAccessStatus> {
  if (server) {
    stopRemoteAccessInternal();
  }

  const { cert, key } = await ensureTlsCredentials(dataDir);
  const newServer = https.createServer({ cert, key }, (req, res) => {
    void handleRequest(req, res, projectService);
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      newServer.removeListener("listening", onListening);
      if (error.code === "EACCES") {
        reject(
          new Error(`Permission denied binding to port ${port} - ports below 1024 need elevated privileges; choose a higher port instead.`)
        );
      } else if (error.code === "EADDRINUSE") {
        reject(new Error(`Port ${port} is already in use by another process.`));
      } else {
        reject(error);
      }
    };
    const onListening = () => {
      newServer.removeListener("error", onError);
      resolve();
    };
    newServer.once("error", onError);
    newServer.once("listening", onListening);
    newServer.listen(port, "0.0.0.0");
  });

  server = newServer;
  currentPort = port;
  currentToken = generateToken();
  currentHost = host && host.trim() !== "" ? host.trim() : pickDefaultAddress();
  unsubscribeSnapshots = projectService.subscribeSnapshots((snapshot) => broadcastSse("snapshot", snapshot));
  heartbeatTimer = setInterval(() => {
    for (const client of sseClients) {
      client.write(": ping\n\n");
    }
  }, HEARTBEAT_MS);
  heartbeatTimer.unref?.();

  return statusFromState();
}

export function disableRemoteAccess(): RemoteAccessStatus {
  stopRemoteAccessInternal();
  return statusFromState();
}

export function regenerateRemoteAccessToken(): RemoteAccessStatus {
  if (!server) {
    return statusFromState();
  }
  currentToken = generateToken();
  return statusFromState();
}

export function setRemoteAccessHost(host: string): RemoteAccessStatus {
  // Only changes the displayed/advertised address, not the actual binding
  // (already 0.0.0.0, i.e. every interface) - so this never needs to touch
  // the listening socket or the token.
  if (server && host.trim() !== "") {
    currentHost = host.trim();
  }
  return statusFromState();
}
