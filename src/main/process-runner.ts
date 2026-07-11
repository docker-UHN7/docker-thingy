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
  | "logs";

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

function withForcedAbort(
  child: ReturnType<typeof spawn> | ReturnType<typeof execFile>,
  signal: AbortSignal | undefined
): void {
  if (!signal) {
    return;
  }

  signal.addEventListener(
    "abort",
    () => {
      child.kill();
      setTimeout(() => {
        if (!child.killed) {
          child.kill("SIGKILL");
        }
      }, 750).unref?.();
    },
    { once: true }
  );
}

export function execCommand(
  file: string,
  args: readonly string[],
  options: ExecCommandOptions
): Promise<ExecCommandResult> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      file,
      [...args],
      {
        cwd: options.cwd,
        windowsHide: true,
        timeout: options.timeoutMs,
        maxBuffer: options.maxBytes,
        signal: options.signal
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }

        resolve({
          stdout,
          stderr,
          exitCode: 0
        });
      }
    );

    withForcedAbort(child, options.signal);
  });
}

export async function streamCommand(
  file: string,
  args: readonly string[],
  options: ExecCommandOptions,
  onChunk: (chunk: string) => void
): Promise<ExecCommandResult> {
  const child = spawn(file, [...args], {
    cwd: options.cwd,
    windowsHide: true,
    signal: options.signal
  });

  withForcedAbort(child, options.signal);

  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    stdout += text;
    onChunk(text);
  });

  child.stderr.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    stderr += text;
  });

  const timeoutId = setTimeout(() => {
    child.kill();
  }, options.timeoutMs);

  const [exitCode] = (await once(child, "close")) as [number];
  clearTimeout(timeoutId);

  return {
    stdout,
    stderr,
    exitCode: exitCode ?? 0
  };
}

