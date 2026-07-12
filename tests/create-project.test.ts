import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectService } from "../src/main/project-service";

const showOpenDialog = vi.fn();
const showMessageBox = vi.fn();

vi.mock("electron", () => ({
  dialog: {
    showOpenDialog: (...args: unknown[]) => showOpenDialog(...args),
    showMessageBox: (...args: unknown[]) => showMessageBox(...args)
  }
}));

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "create-project-"));
  showOpenDialog.mockReset();
  showMessageBox.mockReset();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("ProjectService.createProject", () => {
  it("scaffolds a minimal compose file in an empty folder and opens it", async () => {
    showOpenDialog.mockResolvedValue({ filePaths: [dir] });

    const service = new ProjectService();
    const result = await service.createProject();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.services).toEqual([]);
    expect(showMessageBox).not.toHaveBeenCalled();

    const onDisk = await readFile(join(dir, "docker-compose.yml"), "utf8");
    expect(onDisk).toContain("services: {}");
  });

  it("returns an error when the folder picker is dismissed", async () => {
    showOpenDialog.mockResolvedValue({ filePaths: [] });

    const service = new ProjectService();
    const result = await service.createProject();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_FAILED");
  });

  it("asks before touching a folder that already has a project, and opens it when confirmed", async () => {
    await writeFile(join(dir, "docker-compose.yml"), "services:\n  api:\n    image: api:latest\n", "utf8");
    showOpenDialog.mockResolvedValue({ filePaths: [dir] });
    showMessageBox.mockResolvedValue({ response: 0 });

    const service = new ProjectService();
    const result = await service.createProject();

    expect(showMessageBox).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.services.map((s) => s.name)).toEqual(["api"]);
  });

  it("does not touch the folder when the user cancels the confirmation", async () => {
    const existing = "services:\n  api:\n    image: api:latest\n";
    await writeFile(join(dir, "docker-compose.yml"), existing, "utf8");
    showOpenDialog.mockResolvedValue({ filePaths: [dir] });
    showMessageBox.mockResolvedValue({ response: 1 });

    const service = new ProjectService();
    const result = await service.createProject();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_FAILED");

    const onDisk = await readFile(join(dir, "docker-compose.yml"), "utf8");
    expect(onDisk).toBe(existing);
  });

  it("also detects a bare Dockerfile (no compose file) and asks before opening", async () => {
    await writeFile(join(dir, "Dockerfile"), "FROM node:20\n", "utf8");
    showOpenDialog.mockResolvedValue({ filePaths: [dir] });
    showMessageBox.mockResolvedValue({ response: 0 });

    const service = new ProjectService();
    const result = await service.createProject();

    expect(showMessageBox).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
  });
});
