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
  dir = await mkdtemp(join(tmpdir(), "disconnect-edges-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("ProjectService.disconnectDependency", () => {
  it("removes the dependency and the reloaded project reflects it", async () => {
    await touch(
      "docker-compose.yml",
      "services:\n  api:\n    image: api:latest\n    depends_on:\n      - postgres\n  postgres:\n    image: postgres:16\n"
    );

    const service = new ProjectService();
    const opened = await service.openSourcePath(join(dir, "docker-compose.yml"));
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const result = await service.disconnectDependency(opened.data.id, "api", "postgres");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const reloadedProject = result.data.snapshot.projects.find((p) => p.id === opened.data.id);
    const api = reloadedProject?.services.find((s) => s.name === "api");
    expect(api?.dependencies).toEqual([]);

    const onDisk = await readFile(join(dir, "docker-compose.yml"), "utf8");
    expect(onDisk).not.toContain("depends_on");
  });

  it("rejects a project/service that doesn't exist", async () => {
    const service = new ProjectService();
    const result = await service.disconnectDependency("nonexistent", "api", "postgres");
    expect(result.ok).toBe(false);
  });
});

describe("ProjectService.disconnectVolumeMount", () => {
  it("removes the mount and the reloaded project no longer shows the volume on that service", async () => {
    await touch(
      "docker-compose.yml",
      "services:\n  postgres:\n    image: postgres:16\n    volumes:\n      - postgres-data:/var/lib/postgresql/data\nvolumes:\n  postgres-data:\n"
    );

    const service = new ProjectService();
    const opened = await service.openSourcePath(join(dir, "docker-compose.yml"));
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const result = await service.disconnectVolumeMount(opened.data.id, "postgres", "postgres-data");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const reloadedProject = result.data.snapshot.projects.find((p) => p.id === opened.data.id);
    const postgres = reloadedProject?.services.find((s) => s.name === "postgres");
    expect(postgres?.categories.volumes).toEqual([]);

    const onDisk = await readFile(join(dir, "docker-compose.yml"), "utf8");
    expect(onDisk).not.toContain("postgres-data");
  });

  it("rejects a project/service that doesn't exist", async () => {
    const service = new ProjectService();
    const result = await service.disconnectVolumeMount("nonexistent", "postgres", "postgres-data");
    expect(result.ok).toBe(false);
  });
});
