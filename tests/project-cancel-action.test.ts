import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectService } from "../src/main/project-service";

const mockExecFile = vi.fn();
const mockSpawn = vi.fn();

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execFile: (...args: unknown[]) => mockExecFile(...args),
    spawn: (...args: unknown[]) => mockSpawn(...args)
  };
});

function createAbortableChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: () => boolean;
    killed: boolean;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = vi.fn(() => {
    if (child.killed) {
      return true;
    }
    child.killed = true;
    // Mirrors Node's real child_process `signal` integration: aborting the
    // signal passed to spawn() kills the child AND emits an 'error' event,
    // which `events.once(child, "close")` (used by streamCommand) treats
    // specially and rejects on - that's what actually makes an abort
    // propagate as a thrown error instead of a normal "process closed".
    queueMicrotask(() => {
      const abortError = new Error("The operation was aborted");
      abortError.name = "AbortError";
      child.emit("error", abortError);
    });
    return true;
  });
  return child;
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "cancel-action-"));
  mockExecFile.mockReset();
  mockSpawn.mockReset();

  // The pre-check `docker ps --all` (via execCommand/execFile) resolves
  // immediately with no existing containers, so "start" proceeds straight
  // to the streamed `docker compose up -d` call below.
  mockExecFile.mockImplementation(
    (
      _file: string,
      _args: string[],
      _options: unknown,
      callback: (error: Error | null, stdout: string, stderr: string) => void
    ) => {
      const child = new EventEmitter() as EventEmitter & { kill: () => void };
      child.kill = vi.fn();
      queueMicrotask(() => callback(null, "", ""));
      return child;
    }
  );

  // The actual `docker compose up -d` call hangs until killed - simulating
  // the slow-image-pull scenario Cancel exists for.
  mockSpawn.mockImplementation(() => createAbortableChild());
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("ProjectService.cancelProjectAction", () => {
  it("returns an error when no operation is running for the project", async () => {
    await writeFile(join(dir, "docker-compose.yml"), "services:\n  api:\n    image: api:latest\n", "utf8");
    const service = new ProjectService();
    const opened = await service.openSourcePath(join(dir, "docker-compose.yml"));
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const result = await service.cancelProjectAction(opened.data.id);
    expect(result.ok).toBe(false);
  });

  it("aborts an in-flight operation, resolving it with a CANCELLED result", async () => {
    await writeFile(join(dir, "docker-compose.yml"), "services:\n  api:\n    image: api:latest\n", "utf8");
    const service = new ProjectService();
    const opened = await service.openSourcePath(join(dir, "docker-compose.yml"));
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const runPromise = service.runProjectAction(opened.data.id, "start", () => {});

    // Give the pre-check + spawn chain a tick to register the operation as
    // active before cancelling it.
    await new Promise((resolve) => setTimeout(resolve, 20));

    const cancelResult = await service.cancelProjectAction(opened.data.id);
    expect(cancelResult.ok).toBe(true);

    const outcome = await runPromise;
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe("CANCELLED");

    // The slot is freed once the cancelled operation settles, so a second
    // cancel call correctly reports nothing left to cancel.
    const secondCancel = await service.cancelProjectAction(opened.data.id);
    expect(secondCancel.ok).toBe(false);
  });
});
