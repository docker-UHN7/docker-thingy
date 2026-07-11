import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as https from "node:https";
import * as os from "node:os";
import * as path from "node:path";
import { ProjectService } from "../src/main/project-service";
import {
  disableRemoteAccess,
  enableRemoteAccess,
  regenerateRemoteAccessToken,
  setRemoteAccessHost
} from "../src/main/remote-access-service";

// remote-access-service.ts takes its data directory as a parameter (see
// src/headless.ts, which has no Electron `app` to call getPath on) rather
// than reaching for Electron itself, so no electron mock is needed here.
const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "docker-thingy-remote-access-test-"));
const TEST_PORT = 18443;

function request(
  urlPath: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {}
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "127.0.0.1",
        port: TEST_PORT,
        path: urlPath,
        method: options.method ?? "GET",
        headers: options.headers,
        rejectUnauthorized: false
      },
      (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => (data += chunk.toString("utf8")));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
      }
    );
    req.on("error", reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

describe("remote-access-service", () => {
  let token = "";

  beforeAll(async () => {
    const projectService = new ProjectService();
    const status = await enableRemoteAccess(TEST_PORT, projectService, undefined, TEST_DATA_DIR);
    if (!status.enabled) {
      throw new Error("Expected remote access to enable for the test.");
    }
    token = status.token;
  });

  afterAll(() => {
    disableRemoteAccess();
  });

  it("rejects API requests with no token", async () => {
    const response = await request("/api/snapshot");
    expect(response.status).toBe(401);
  });

  it("rejects API requests with an incorrect token", async () => {
    const response = await request("/api/snapshot", { headers: { Authorization: "Bearer not-the-real-token" } });
    expect(response.status).toBe(401);
  });

  it("accepts API requests with the correct bearer token", async () => {
    const response = await request("/api/snapshot", { headers: { Authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toHaveProperty("projects");
  });

  it("rejects the root document without a token", async () => {
    const response = await request("/");
    expect(response.status).toBe(401);
  });

  it("serves the root document given the token as a query string", async () => {
    const response = await request(`/?token=${token}`);
    expect(response.status).toBe(200);
    expect(response.body).toContain("<div id=\"root\">");
  });

  it("serves the built static JS bundle without requiring a token", async () => {
    const response = await request("/main_window/index.js");
    expect(response.status).toBe(200);
  });

  it("never exposes the remote-access lifecycle itself over HTTP", async () => {
    const response = await request("/api/remote-access/enable", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(response.status).toBe(404);
  });

  it("streams SSE events on /api/events for an authorized client", async () => {
    const chunk = await new Promise<string>((resolve, reject) => {
      const req = https.request(
        {
          hostname: "127.0.0.1",
          port: TEST_PORT,
          path: `/api/events?token=${token}`,
          method: "GET",
          rejectUnauthorized: false
        },
        (res) => {
          res.on("data", (data: Buffer) => {
            resolve(data.toString("utf8"));
            req.destroy();
          });
          res.on("error", reject);
        }
      );
      req.on("error", (error) => {
        if (!(error as NodeJS.ErrnoException).message.includes("socket hang up")) {
          reject(error);
        }
      });
      req.end();
    });

    expect(chunk).toContain("connected");
  });

  it("regenerating the token invalidates the old one and accepts the new one", async () => {
    const oldToken = token;
    const status = regenerateRemoteAccessToken();
    expect(status.enabled).toBe(true);
    if (!status.enabled) {
      return;
    }

    const withOldToken = await request("/api/snapshot", { headers: { Authorization: `Bearer ${oldToken}` } });
    expect(withOldToken.status).toBe(401);

    const withNewToken = await request("/api/snapshot", { headers: { Authorization: `Bearer ${status.token}` } });
    expect(withNewToken.status).toBe(200);
    token = status.token;
  });

  it("advertises a custom host without changing the token or requiring re-enable", () => {
    const status = setRemoteAccessHost("example.test");
    expect(status.enabled).toBe(true);
    if (!status.enabled) {
      return;
    }
    expect(status.host).toBe("example.test");
    expect(status.url).toContain("https://example.test:");
    expect(status.token).toBe(token);
  });
});
