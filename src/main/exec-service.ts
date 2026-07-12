import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { ExecExitEvent, ExecOutputEvent } from "../shared/contracts";
import { isValidContainerRef } from "./validation";

// No pty is allocated on either side of this (no node-pty dependency, which
// would add a native module that needs prebuilt binaries per platform/Electron
// ABI) - this is plain line-buffered stdin/stdout streaming over
// `docker exec -i <id> sh`. Good enough for running ordinary commands without
// leaving the app; curses-style programs (vim, top, an interactive REPL that
// expects a real TTY) won't render correctly.
const MAX_CONCURRENT_SESSIONS = 8;

type ExecSession = {
  containerId: string;
  child: ChildProcessWithoutNullStreams;
};

const sessions = new Map<string, ExecSession>();

export function startContainerExec(
  containerId: string,
  onOutput: (event: ExecOutputEvent) => void,
  onExit: (event: ExecExitEvent) => void
): string {
  if (!isValidContainerRef(containerId)) {
    throw new Error("Invalid container id.");
  }
  if (sessions.size >= MAX_CONCURRENT_SESSIONS) {
    throw new Error("Too many open shell sessions - close one before starting another.");
  }

  const sessionId = randomUUID();
  const child = spawn("docker", ["exec", "-i", containerId, "sh"], {
    stdio: ["pipe", "pipe", "pipe"]
  });

  sessions.set(sessionId, { containerId, child });

  child.stdout.on("data", (chunk: Buffer) => {
    onOutput({ sessionId, stream: "stdout", chunk: chunk.toString("utf8") });
  });
  child.stderr.on("data", (chunk: Buffer) => {
    onOutput({ sessionId, stream: "stderr", chunk: chunk.toString("utf8") });
  });
  child.on("close", (code) => {
    sessions.delete(sessionId);
    onExit({ sessionId, exitCode: code });
  });
  child.on("error", (error) => {
    sessions.delete(sessionId);
    onOutput({ sessionId, stream: "stderr", chunk: `\r\n[exec] ${error.message}\r\n` });
    onExit({ sessionId, exitCode: null });
  });

  return sessionId;
}

export function writeToContainerExec(sessionId: string, data: string): void {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error("No such shell session (it may have already closed).");
  }

  session.child.stdin.write(data);
}

export function stopContainerExec(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session) {
    return;
  }

  session.child.kill();
  sessions.delete(sessionId);
}

/** Kills every open exec session - called on app quit so no `docker exec` child survives the window that spawned it. */
export function disposeAllExecSessions(): void {
  for (const [sessionId, session] of sessions) {
    session.child.kill();
    sessions.delete(sessionId);
  }
}
