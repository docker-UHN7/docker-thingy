import { describe, expect, it } from "vitest";
import { execCommand, isTimeoutError } from "../src/main/process-runner";

describe("execCommand timeout handling", () => {
  it("rejects with a classifiable timeout error once timeoutMs elapses, without hanging", async () => {
    // A short-lived node process that outlives the timeout we give execCommand.
    const promise = execCommand(process.execPath, ["-e", "setTimeout(() => {}, 5000)"], {
      timeoutMs: 200,
      maxBytes: 1024,
      category: "capability-check"
    });

    await expect(promise).rejects.toSatisfy((error: unknown) => isTimeoutError(error));
  });

  it("does not classify a normal command failure as a timeout", async () => {
    const promise = execCommand(process.execPath, ["-e", "process.exit(1)"], {
      timeoutMs: 5000,
      maxBytes: 1024,
      category: "capability-check"
    });

    await expect(promise).rejects.toSatisfy((error: unknown) => !isTimeoutError(error));
  });

  it("resolves normally for commands that finish before the timeout", async () => {
    const result = await execCommand(process.execPath, ["-e", "process.stdout.write('ok')"], {
      timeoutMs: 5000,
      maxBytes: 1024,
      category: "capability-check"
    });

    expect(result.stdout).toBe("ok");
  });
});
