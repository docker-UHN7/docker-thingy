import { execFile, spawn } from "node:child_process";
import { once } from "node:events";

export const PROCESS_LIMITS = {
  capabilityCheckMs: 10_000,
  runtimeDiscoveryMs: 20_000,
  composeValidationMs: 30_000,
  dockerfileCheckMs: 60_000,
  composeOperationMs: 120_000,
  imageBuildMs: 15 * 60_000,
  logFetchMs: 15_000,
  statsFetchMs: 15_000,
  maxJsonBytes: 20 * 1024 * 1024,
  maxDiagnosticBytes: 10 * 1024 * 1024,
  maxLogBytes: 2 * 1024 * 1024
} as const;

export type CommandCategory =
  | "capability-check"
  | "runtime-discovery"
  | "compose-validation"
  | "compose-operation"
  | "dockerfile-check"
  | "docker-build"
  | "logs"
  | "stats";

export type ExecCommandOptions = {
  cwd?: string;
  timeoutMs: number;
  maxBytes: number;
  category: CommandCategory;
  signal?: AbortSignal;
};

export type ExecCommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

const FORCE_KILL_GRACE_MS = 750;

/**
 * Kills `child` when `signal` aborts, escalating to SIGKILL if the process is
 * still alive after a short grace period (some processes ignore/ don't react
 * to the initial, gentler signal).
 */
function withForcedAbort(
  child: ReturnType<typeof spawn> | ReturnType<typeof execFile>,
  signal: AbortSignal
): void {
  const escalate = () => {
    child.kill();
    setTimeout(() => {
      if (!child.killed) {
        child.kill("SIGKILL");
      }
    }, FORCE_KILL_GRACE_MS).unref?.();
  };

  if (signal.aborted) {
    escalate();
    return;
  }

  signal.addEventListener("abort", escalate, { once: true });
}

function createTimeoutController(
  timeoutMs: number,
  externalSignal: AbortSignal | undefined
): { signal: AbortSignal; timedOut: () => boolean; dispose: () => void } {
  const controller = new AbortController();
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  timer.unref?.();

  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener("abort", onExternalAbort, { once: true });
    }
  }

  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose: () => {
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", onExternalAbort);
    }
  };
}

function toTimeoutError(file: string, args: readonly string[], timeoutMs: number): NodeJS.ErrnoException {
  const error = new Error(
    `Command timed out after ${timeoutMs}ms: ${file} ${args.join(" ")}`
  ) as NodeJS.ErrnoException;
  error.code = "ETIMEDOUT";
  return error;
}

/** True when `error` was produced because an execCommand/streamCommand call exceeded its timeoutMs. */
export function isTimeoutError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === "ETIMEDOUT"
  );
}

export function execCommand(
  file: string,
  args: readonly string[],
  options: ExecCommandOptions
): Promise<ExecCommandResult> {
  return new Promise((resolve, reject) => {
    const timeout = createTimeoutController(options.timeoutMs, options.signal);

    const child = execFile(
      file,
      [...args],
      {
        cwd: options.cwd,
        windowsHide: true,
        maxBuffer: options.maxBytes,
        signal: timeout.signal
      },
      (error, stdout, stderr) => {
        timeout.dispose();

        if (error) {
          reject(timeout.timedOut() ? toTimeoutError(file, args, options.timeoutMs) : error);
          return;
        }

        resolve({
          stdout,
          stderr,
          exitCode: 0
        });
      }
    );

    withForcedAbort(child, timeout.signal);
  });
}

export async function streamCommand(
  file: string,
  args: readonly string[],
  options: ExecCommandOptions,
  onChunk: (chunk: string, stream: "stdout" | "stderr") => void
): Promise<ExecCommandResult> {
  const timeout = createTimeoutController(options.timeoutMs, options.signal);

  const child = spawn(file, [...args], {
    cwd: options.cwd,
    windowsHide: true,
    signal: timeout.signal
  });

  withForcedAbort(child, timeout.signal);

  let stdout = "";
  let stderr = "";

  // Docker CLI commands (compose up/build, docker build) write most of their
  // human-facing progress to stderr even on success, so callers that want a
  // live-streaming log (not just the final buffered text) need both streams
  // tagged and forwarded, not just stdout.
  child.stdout.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    stdout += text;
    onChunk(text, "stdout");
  });

  child.stderr.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    stderr += text;
    onChunk(text, "stderr");
  });

  try {
    const [exitCode] = (await once(child, "close")) as [number];
    return {
      stdout,
      stderr,
      exitCode: exitCode ?? 0
    };
  } catch (error) {
    throw timeout.timedOut() ? toTimeoutError(file, args, options.timeoutMs) : error;
  } finally {
    timeout.dispose();
  }
}
