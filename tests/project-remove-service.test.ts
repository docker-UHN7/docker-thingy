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
  dir = await mkdtemp(join(tmpdir(), "remove-service-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("ProjectService.removeServiceFromProject", () => {
  it("removes a service, writes it to disk, and the reloaded project no longer lists it", async () => {
    await touch(
      "docker-compose.yml",
      "services:\n  api:\n    image: api:latest\n    depends_on:\n      - postgres\n  postgres:\n    image: postgres:16\n"
    );

    const service = new ProjectService();
    const opened = await service.openSourcePath(join(dir, "docker-compose.yml"));
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const result = await service.removeServiceFromProject(opened.data.id, "postgres");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const reloadedProject = result.data.snapshot.projects.find((p) => p.id === opened.data.id);
    expect(reloadedProject?.services.map((s) => s.name)).toEqual(["api"]);

    const onDisk = await readFile(join(dir, "docker-compose.yml"), "utf8");
    expect(onDisk).not.toContain("postgres");
  });

  it("rejects removing a service that doesn't exist in the project", async () => {
    await touch("docker-compose.yml", "services:\n  api:\n    image: api:latest\n");

    const service = new ProjectService();
    const opened = await service.openSourcePath(join(dir, "docker-compose.yml"));
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const result = await service.removeServiceFromProject(opened.data.id, "does-not-exist");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_FAILED");
  });

  it("rejects removing from a project that is not an editable Compose project", async () => {
    const service = new ProjectService();
    const result = await service.removeServiceFromProject("nonexistent-project-id", "api");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_FAILED");
  });
});
