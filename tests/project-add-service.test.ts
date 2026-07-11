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
  dir = await mkdtemp(join(tmpdir(), "add-service-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("ProjectService.addServiceToProject", () => {
  it("adds a service, writes it to disk, and the reloaded project shows it as a node", async () => {
    await touch("docker-compose.yml", "services:\n  api:\n    image: api:latest\n");

    const service = new ProjectService();
    const opened = await service.openSourcePath(join(dir, "docker-compose.yml"));
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const result = await service.addServiceToProject(opened.data.id, {
      serviceName: "postgres",
      image: "postgres:16",
      environment: { POSTGRES_USER: "app", POSTGRES_PASSWORD: "app" },
      connectTo: [{ serviceName: "api", environment: { DATABASE_URL: "postgres://app:app@postgres:5432/app" } }]
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const reloadedProject = result.data.snapshot.projects.find((p) => p.id === opened.data.id);
    expect(reloadedProject?.services.map((s) => s.name)).toEqual(expect.arrayContaining(["api", "postgres"]));

    const onDisk = await readFile(join(dir, "docker-compose.yml"), "utf8");
    expect(onDisk).toContain("image: postgres:16");
    expect(onDisk).toContain("DATABASE_URL: postgres://app:app@postgres:5432/app");
  });

  it("rejects a service name that collides with an existing service", async () => {
    await touch("docker-compose.yml", "services:\n  api:\n    image: api:latest\n");

    const service = new ProjectService();
    const opened = await service.openSourcePath(join(dir, "docker-compose.yml"));
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const result = await service.addServiceToProject(opened.data.id, { serviceName: "api", image: "postgres:16" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_FAILED");
  });

  it("rejects an invalid service name", async () => {
    await touch("docker-compose.yml", "services:\n  api:\n    image: api:latest\n");

    const service = new ProjectService();
    const opened = await service.openSourcePath(join(dir, "docker-compose.yml"));
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const result = await service.addServiceToProject(opened.data.id, { serviceName: "Not Valid!", image: "postgres:16" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_FAILED");
  });

  it("rejects connecting to a service that doesn't exist in the project", async () => {
    await touch("docker-compose.yml", "services:\n  api:\n    image: api:latest\n");

    const service = new ProjectService();
    const opened = await service.openSourcePath(join(dir, "docker-compose.yml"));
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const result = await service.addServiceToProject(opened.data.id, {
      serviceName: "postgres",
      image: "postgres:16",
      connectTo: [{ serviceName: "does-not-exist", environment: {} }]
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_FAILED");
  });

  it("rejects an invalid image tag", async () => {
    await touch("docker-compose.yml", "services:\n  api:\n    image: api:latest\n");

    const service = new ProjectService();
    const opened = await service.openSourcePath(join(dir, "docker-compose.yml"));
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const result = await service.addServiceToProject(opened.data.id, { serviceName: "postgres", image: "not a valid image!" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_FAILED");
  });
});
