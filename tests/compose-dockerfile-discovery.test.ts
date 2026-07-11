import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadComposeProject } from "../src/main/compose-service";

let dir: string;

async function touch(relativePath: string, contents: string): Promise<void> {
  const fullPath = join(dir, relativePath);
  await mkdir(join(fullPath, ".."), { recursive: true });
  await writeFile(fullPath, contents, "utf8");
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "compose-dockerfile-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("loadComposeProject dockerfile discovery", () => {
  it("resolves the default Dockerfile inside a service's build context", async () => {
    await touch("api/Dockerfile", "FROM node:20\n");
    await touch(
      "docker-compose.yml",
      "services:\n  api:\n    build:\n      context: ./api\n"
    );

    const project = await loadComposeProject(join(dir, "docker-compose.yml"), "ctx");
    expect(project.dockerfilePaths).toEqual([join(dir, "api", "Dockerfile")]);
  });

  it("honors a custom dockerfile name relative to the build context", async () => {
    await touch("api/Dockerfile.prod", "FROM node:20\n");
    await touch(
      "docker-compose.yml",
      "services:\n  api:\n    build:\n      context: ./api\n      dockerfile: Dockerfile.prod\n"
    );

    const project = await loadComposeProject(join(dir, "docker-compose.yml"), "ctx");
    expect(project.dockerfilePaths).toEqual([join(dir, "api", "Dockerfile.prod")]);
  });

  it("dedupes when multiple services share the same Dockerfile", async () => {
    await touch("Dockerfile", "FROM node:20\n");
    await touch(
      "docker-compose.yml",
      "services:\n  api:\n    build: .\n  worker:\n    build: .\n"
    );

    const project = await loadComposeProject(join(dir, "docker-compose.yml"), "ctx");
    expect(project.dockerfilePaths).toEqual([join(dir, "Dockerfile")]);
  });

  it("skips a build context that doesn't resolve to a local Dockerfile", async () => {
    await touch(
      "docker-compose.yml",
      "services:\n  api:\n    build:\n      context: https://example.com/repo.git\n  web:\n    image: nginx:latest\n"
    );

    const project = await loadComposeProject(join(dir, "docker-compose.yml"), "ctx");
    expect(project.dockerfilePaths).toEqual([]);
  });

  it("omits a referenced Dockerfile that doesn't actually exist on disk", async () => {
    await touch(
      "docker-compose.yml",
      "services:\n  api:\n    build:\n      context: ./missing\n"
    );

    const project = await loadComposeProject(join(dir, "docker-compose.yml"), "ctx");
    expect(project.dockerfilePaths).toEqual([]);
  });
});
