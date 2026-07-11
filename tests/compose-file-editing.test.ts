import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProjectService } from "../src/main/project-service";

let dir: string;

async function touch(name: string, contents: string): Promise<void> {
  await writeFile(join(dir, name), contents, "utf8");
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "compose-edit-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("ProjectService compose file editing", () => {
  it("reads back the exact source text and a matching hash", async () => {
    await touch("docker-compose.yml", "services:\n  web:\n    image: nginx:latest\n");

    const service = new ProjectService();
    const opened = await service.openSourcePath(join(dir, "docker-compose.yml"));
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const filePath = join(dir, "docker-compose.yml");
    const read = await service.readSourceFile(opened.data.id, filePath);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.data.sourceText).toContain("nginx:latest");
  });

  it("saves valid edits atomically and reloads the project's services", async () => {
    await touch("docker-compose.yml", "services:\n  web:\n    image: nginx:latest\n");

    const service = new ProjectService();
    const opened = await service.openSourcePath(join(dir, "docker-compose.yml"));
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const filePath = join(dir, "docker-compose.yml");
    const read = await service.readSourceFile(opened.data.id, filePath);
    expect(read.ok).toBe(true);
    if (!read.ok) return;

    const nextText = "services:\n  web:\n    image: nginx:1.27\n";
    const saved = await service.saveSourceFile(opened.data.id, filePath, nextText, read.data.hash);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    const onDisk = await readFile(filePath, "utf8");
    expect(onDisk).toBe(nextText);

    const reloadedProject = saved.data.snapshot.projects.find((p) => p.id === opened.data.id);
    expect(reloadedProject?.services.find((s) => s.name === "web")?.image).toBe("nginx:1.27");
  });

  it("rejects a save with invalid YAML without touching the file on disk", async () => {
    const original = "services:\n  web:\n    image: nginx:latest\n";
    await touch("docker-compose.yml", original);

    const service = new ProjectService();
    const opened = await service.openSourcePath(join(dir, "docker-compose.yml"));
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const filePath = join(dir, "docker-compose.yml");
    const read = await service.readSourceFile(opened.data.id, filePath);
    expect(read.ok).toBe(true);
    if (!read.ok) return;

    const broken = "services:\n  web:\n  image: [unterminated\n";
    const saved = await service.saveSourceFile(opened.data.id, filePath, broken, read.data.hash);
    expect(saved.ok).toBe(false);
    if (saved.ok) return;
    expect(saved.error.code).toBe("VALIDATION_FAILED");

    const onDisk = await readFile(filePath, "utf8");
    expect(onDisk).toBe(original);
  });

  it("refuses to save a path that isn't one of the project's known compose files", async () => {
    await touch("docker-compose.yml", "services:\n  web:\n    image: nginx:latest\n");
    const outsidePath = join(dir, "..", "escape.yml");

    const service = new ProjectService();
    const opened = await service.openSourcePath(join(dir, "docker-compose.yml"));
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const saved = await service.saveSourceFile(opened.data.id, outsidePath, "services: {}\n", "deadbeef");
    expect(saved.ok).toBe(false);
    if (saved.ok) return;
    expect(saved.error.code).toBe("VALIDATION_FAILED");
  });

  it("detects a stale hash when the file changed on disk since it was read", async () => {
    await touch("docker-compose.yml", "services:\n  web:\n    image: nginx:latest\n");

    const service = new ProjectService();
    const opened = await service.openSourcePath(join(dir, "docker-compose.yml"));
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const filePath = join(dir, "docker-compose.yml");
    const read = await service.readSourceFile(opened.data.id, filePath);
    expect(read.ok).toBe(true);
    if (!read.ok) return;

    // Simulate an external edit landing between read and save.
    await writeFile(filePath, "services:\n  web:\n    image: nginx:external-edit\n", "utf8");

    const saved = await service.saveSourceFile(opened.data.id, filePath, "services:\n  web:\n    image: nginx:mine\n", read.data.hash);
    expect(saved.ok).toBe(false);
    if (saved.ok) return;
    expect(saved.error.code).toBe("SOURCE_CHANGED_EXTERNALLY");
  });

  it("lets a Dockerfile discovered from a service's build context be read and saved", async () => {
    await writeFile(join(dir, "Dockerfile"), "FROM node:20\n", "utf8");
    await touch("docker-compose.yml", "services:\n  api:\n    build: .\n");

    const service = new ProjectService();
    const opened = await service.openSourcePath(join(dir, "docker-compose.yml"));
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const dockerfilePath = join(dir, "Dockerfile");
    expect(opened.data.dockerfilePaths).toEqual([dockerfilePath]);

    const read = await service.readSourceFile(opened.data.id, dockerfilePath);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.data.sourceText).toContain("FROM node:20");

    // Not YAML - a Dockerfile line like this would trip a YAML parser
    // ("RUN:" reads as a mapping key), so this also proves the save path
    // skips YAML validation for Dockerfile targets.
    const nextText = 'FROM node:20\nLABEL note="RUN: build step"\n';
    const saved = await service.saveSourceFile(opened.data.id, dockerfilePath, nextText, read.data.hash);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    const onDisk = await readFile(dockerfilePath, "utf8");
    expect(onDisk).toBe(nextText);
  });

  it("refuses to save a Dockerfile that isn't reachable from the project", async () => {
    await touch("docker-compose.yml", "services:\n  web:\n    image: nginx:latest\n");
    await writeFile(join(dir, "Dockerfile"), "FROM node:20\n", "utf8");

    const service = new ProjectService();
    const opened = await service.openSourcePath(join(dir, "docker-compose.yml"));
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    // No service in this compose file declares a build context, so the
    // sibling Dockerfile was never discovered and isn't in the allowlist.
    expect(opened.data.dockerfilePaths).toEqual([]);

    const saved = await service.saveSourceFile(opened.data.id, join(dir, "Dockerfile"), "FROM node:22\n", "deadbeef");
    expect(saved.ok).toBe(false);
    if (saved.ok) return;
    expect(saved.error.code).toBe("VALIDATION_FAILED");
  });
});
