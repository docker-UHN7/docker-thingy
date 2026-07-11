import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanDirectoryForComposeProjects } from "../src/main/project-service";

let dir: string;

async function touch(...names: string[]): Promise<void> {
  await Promise.all(names.map((name) => writeFile(join(dir, name), "services: {}\n", "utf8")));
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "compose-scan-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("scanDirectoryForComposeProjects", () => {
  it("groups a main compose file with its override under one project", async () => {
    await touch("compose.yaml", "compose.override.yaml");

    const groups = await scanDirectoryForComposeProjects(dir);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.mainFile).toBe(join(dir, "compose.yaml"));
    expect(groups[0]?.allConfigFiles.sort()).toEqual(
      [join(dir, "compose.yaml"), join(dir, "compose.override.yaml")].sort()
    );
    // The override is auto-selected by default alongside the main file.
    expect(groups[0]?.defaultSelected.sort()).toEqual(
      [join(dir, "compose.yaml"), join(dir, "compose.override.yaml")].sort()
    );
  });

  it("treats differently-named main compose files as independent projects", async () => {
    await touch("docker-compose-auth.yml", "docker-compose-payment.yml");

    const groups = await scanDirectoryForComposeProjects(dir);

    expect(groups).toHaveLength(2);
    const mainFiles = groups.map((group) => group.mainFile).sort();
    expect(mainFiles).toEqual(
      [join(dir, "docker-compose-auth.yml"), join(dir, "docker-compose-payment.yml")].sort()
    );
    // Neither project pulls in the other's file.
    for (const group of groups) {
      expect(group.allConfigFiles).toEqual([group.mainFile]);
    }
  });

  it("does not auto-select a profile file that isn't an override", async () => {
    await touch("docker-compose.yml", "docker-compose.debug.yml");

    const groups = await scanDirectoryForComposeProjects(dir);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.mainFile).toBe(join(dir, "docker-compose.yml"));
    expect(groups[0]?.allConfigFiles.sort()).toEqual(
      [join(dir, "docker-compose.yml"), join(dir, "docker-compose.debug.yml")].sort()
    );
    // Not an "override" named file, so it's discoverable but not pre-checked.
    expect(groups[0]?.defaultSelected).toEqual([join(dir, "docker-compose.yml")]);
  });

  it("ignores non-compose yaml files", async () => {
    await touch("docker-compose.yml", "values.yaml");

    const groups = await scanDirectoryForComposeProjects(dir);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.allConfigFiles).toEqual([join(dir, "docker-compose.yml")]);
  });

  it("returns no groups for a directory with no compose files", async () => {
    await touch("readme.txt");

    const groups = await scanDirectoryForComposeProjects(dir);

    expect(groups).toHaveLength(0);
  });
});
