import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProjectService } from "../src/main/project-service";

let dir: string;

async function touch(name: string, contents: string): Promise<void> {
  await writeFile(join(dir, name), contents, "utf8");
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "compose-update-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("ProjectService.updateProjectConfigFiles", () => {
  it("keeps a grouped project's groupId/groupLabel after toggling its active compose files", async () => {
    await touch("docker-compose-auth.yml", "services:\n  auth:\n    image: auth:latest\n");
    await touch("docker-compose-payment.yml", "services:\n  payment:\n    image: payment:latest\n");

    const service = new ProjectService();
    const opened = await service.openSourcePath(join(dir, "docker-compose-auth.yml"));
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    // Sanity check: opening a folder with two independent main compose files
    // groups them (this is what makes the sidebar fold them into one card
    // and the workspace show a tab strip between them).
    expect(opened.data.groupId).toBe(dir);

    const updated = await service.updateProjectConfigFiles(opened.data.id, opened.data.configFiles);
    const updatedProject = updated.projects.find((p) => p.id === opened.data.id);

    expect(updatedProject?.groupId).toBe(dir);
    expect(updatedProject?.groupLabel).toBe(opened.data.groupLabel);
  });

  it("leaves a lone (ungrouped) project's undefined groupId alone after an update", async () => {
    await touch("docker-compose.yml", "services:\n  web:\n    image: nginx:latest\n");

    const service = new ProjectService();
    const opened = await service.openSourcePath(join(dir, "docker-compose.yml"));
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    expect(opened.data.groupId).toBeUndefined();

    const updated = await service.updateProjectConfigFiles(opened.data.id, opened.data.configFiles);
    const updatedProject = updated.projects.find((p) => p.id === opened.data.id);

    expect(updatedProject?.groupId).toBeUndefined();
  });
});
