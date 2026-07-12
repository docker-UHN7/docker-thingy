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
  dir = await mkdtemp(join(tmpdir(), "service-fields-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("ProjectService.getServiceFields / updateServiceFields", () => {
  it("reads and then writes a service's fields end to end", async () => {
    await touch("docker-compose.yml", "services:\n  api:\n    image: api:latest\n  postgres:\n    image: postgres:16\n");

    const service = new ProjectService();
    const opened = await service.openSourcePath(join(dir, "docker-compose.yml"));
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const read = await service.getServiceFields(opened.data.id, "api");
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.data.fields.image).toBe("api:latest");

    const updated = await service.updateServiceFields(opened.data.id, "api", {
      image: "api:1.2.3",
      restart: "always",
      ports: ["8080:80"],
      dependsOn: ["postgres"],
      environment: { NODE_ENV: "production" }
    });

    expect(updated.ok).toBe(true);
    if (!updated.ok) return;

    const reloadedProject = updated.data.snapshot.projects.find((p) => p.id === opened.data.id);
    const apiService = reloadedProject?.services.find((s) => s.name === "api");
    expect(apiService?.image).toBe("api:1.2.3");
    expect(apiService?.dependencies).toEqual(["postgres"]);

    const onDisk = await readFile(join(dir, "docker-compose.yml"), "utf8");
    expect(onDisk).toContain("restart: always");
    expect(onDisk).toContain("NODE_ENV: production");
  });

  it("rejects an invalid image tag", async () => {
    await touch("docker-compose.yml", "services:\n  api:\n    image: api:latest\n");

    const service = new ProjectService();
    const opened = await service.openSourcePath(join(dir, "docker-compose.yml"));
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const result = await service.updateServiceFields(opened.data.id, "api", { image: "not a valid image!" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_FAILED");
  });

  it("rejects an invalid restart policy", async () => {
    await touch("docker-compose.yml", "services:\n  api:\n    image: api:latest\n");

    const service = new ProjectService();
    const opened = await service.openSourcePath(join(dir, "docker-compose.yml"));
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const result = await service.updateServiceFields(opened.data.id, "api", { restart: "sometimes" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_FAILED");
  });

  it("rejects a depends_on entry that references a nonexistent service", async () => {
    await touch("docker-compose.yml", "services:\n  api:\n    image: api:latest\n");

    const service = new ProjectService();
    const opened = await service.openSourcePath(join(dir, "docker-compose.yml"));
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const result = await service.updateServiceFields(opened.data.id, "api", { dependsOn: ["does-not-exist"] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_FAILED");
  });

  it("rejects a service depending on itself", async () => {
    await touch("docker-compose.yml", "services:\n  api:\n    image: api:latest\n");

    const service = new ProjectService();
    const opened = await service.openSourcePath(join(dir, "docker-compose.yml"));
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const result = await service.updateServiceFields(opened.data.id, "api", { dependsOn: ["api"] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_FAILED");
  });

  it("rejects reading/writing a service that doesn't exist in the project", async () => {
    await touch("docker-compose.yml", "services:\n  api:\n    image: api:latest\n");

    const service = new ProjectService();
    const opened = await service.openSourcePath(join(dir, "docker-compose.yml"));
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const read = await service.getServiceFields(opened.data.id, "does-not-exist");
    expect(read.ok).toBe(false);

    const write = await service.updateServiceFields(opened.data.id, "does-not-exist", { image: "x:1" });
    expect(write.ok).toBe(false);
  });
});
