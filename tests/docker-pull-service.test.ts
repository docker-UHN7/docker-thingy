import { describe, expect, it, vi } from "vitest";
import { pullImage } from "../src/main/docker-pull-service";

// vi.mock is hoisted above these imports, so the mocks it references have to
// be created via vi.hoisted rather than plain module-scope consts.
const { mockPull, mockFollowProgress } = vi.hoisted(() => ({
  mockPull: vi.fn(),
  mockFollowProgress: vi.fn()
}));

vi.mock("dockerode", () => ({
  default: vi.fn().mockImplementation(function MockDocker(this: { pull: typeof mockPull; modem: unknown }) {
    this.pull = mockPull;
    this.modem = { followProgress: mockFollowProgress };
  })
}));

describe("pullImage", () => {
  it("resolves and reports each progress line for a successful pull", async () => {
    mockPull.mockResolvedValue({} as NodeJS.ReadableStream);
    mockFollowProgress.mockImplementation(
      (_stream: unknown, onFinished: (error: Error | null) => void, onProgress: (line: unknown) => void) => {
        onProgress({ status: "Downloading", id: "abc123", progressDetail: { current: 50, total: 100 } });
        onProgress({ status: "Pull complete", id: "abc123" });
        onFinished(null);
      }
    );

    const events: unknown[] = [];
    await pullImage("postgres:16", (event) => events.push(event));

    expect(mockPull).toHaveBeenCalledWith("postgres:16");
    expect(events).toEqual([
      { image: "postgres:16", status: "Downloading", id: "abc123", current: 50, total: 100 },
      { image: "postgres:16", status: "Pull complete", id: "abc123", current: undefined, total: undefined }
    ]);
  });

  it("rejects when the pull itself fails (bad tag, etc.)", async () => {
    mockPull.mockResolvedValue({} as NodeJS.ReadableStream);
    mockFollowProgress.mockImplementation((_stream: unknown, onFinished: (error: Error | null) => void) => {
      onFinished(new Error("manifest unknown"));
    });

    await expect(pullImage("does-not-exist:latest", () => {})).rejects.toThrow("manifest unknown");
  });

  it("rejects when the daemon can't be reached", async () => {
    mockPull.mockRejectedValue(new Error("connect ENOENT //./pipe/docker_engine"));

    await expect(pullImage("postgres:16", () => {})).rejects.toThrow(/docker_engine/);
  });
});
