import { dirname } from "node:path";
import type { ExecutableProjectActionId, OperationStream, ProjectSummary, ValidationOutcome } from "../shared/contracts";
import { validateImageTag } from "./dockerfile-service";
import { PROCESS_LIMITS, streamCommand, type CommandCategory } from "./process-runner";

export type OperationSink = (stream: OperationStream, line: string) => void;

/**
 * Buffers partial chunks per-stream and only forwards complete lines to the
 * sink, so the renderer's log view never sees a line split mid-word across
 * two `data` events. Any partial trailing content is flushed once the process
 * exits (docker doesn't always end its output with a trailing newline).
 */
function createLineEmitter(sink: OperationSink) {
  const buffers: Record<OperationStream, string> = { stdout: "", stderr: "" };

  return {
    push(stream: OperationStream, chunk: string) {
      buffers[stream] += chunk;
      const parts = buffers[stream].split(/\r?\n/);
      buffers[stream] = parts.pop() ?? "";
      for (const part of parts) {
        sink(stream, part);
      }
    },
    flush() {
      for (const stream of ["stdout", "stderr"] as const) {
        if (buffers[stream].length > 0) {
          sink(stream, buffers[stream]);
          buffers[stream] = "";
        }
      }
    }
  };
}

/** Turns a project title into a Docker-tag-safe slug (e.g. for a default build tag). */
function slugifyImageName(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/\.[^./\\]+$/, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "");

  return slug.length > 0 ? slug : "project";
}

async function runStreamed(
  file: string,
  args: readonly string[],
  timeoutMs: number,
  category: CommandCategory,
  sink: OperationSink,
  successTitle: string,
  failureTitle: string
): Promise<ValidationOutcome> {
  const emitter = createLineEmitter(sink);

  try {
    const result = await streamCommand(
      file,
      args,
      { timeoutMs, maxBytes: PROCESS_LIMITS.maxDiagnosticBytes, category },
      (chunk, stream) => emitter.push(stream, chunk)
    );
    emitter.flush();

    if (result.exitCode !== 0) {
      return {
        ok: false,
        title: failureTitle,
        detail: result.stderr.trim() || result.stdout.trim() || `${file} exited with code ${result.exitCode}.`
      };
    }

    return {
      ok: true,
      title: successTitle,
      detail: result.stdout.trim() || result.stderr.trim() || "Completed without errors."
    };
  } catch (error) {
    emitter.flush();
    throw error;
  }
}

/**
 * Resolves a `ProjectAction` into the actual `docker`/`docker compose`
 * invocation and runs it, streaming output lines to `sink` as they arrive.
 * The caller (ProjectService) is responsible for concurrency guarding,
 * updating the snapshot, and mapping thrown errors (e.g. timeouts) to a
 * Result - this function only knows how to run one action to completion.
 */
export async function executeProjectAction(
  project: ProjectSummary,
  actionId: ExecutableProjectActionId,
  sink: OperationSink
): Promise<ValidationOutcome> {
  const configFiles = project.configFiles.length > 0 ? project.configFiles : (project.sourcePath ? [project.sourcePath] : []);
  const configPath = configFiles[0];
  const isDockerfile = project.runtimeKind === "dockerfile";

  if (!configPath) {
    return {
      ok: false,
      title: "No source file available",
      detail: "This project has no resolvable Compose file or Dockerfile path to operate on."
    };
  }

  const fileArgs = isDockerfile ? [] : configFiles.flatMap((file) => ["-f", file]);

  switch (actionId) {
    case "validate":
      return isDockerfile
        ? runStreamed(
            "docker",
            ["build", "--check", "-f", configPath, dirname(configPath)],
            PROCESS_LIMITS.dockerfileCheckMs,
            "dockerfile-check",
            sink,
            "Dockerfile looks valid",
            "Dockerfile validation failed"
          )
        : runStreamed(
            "docker",
            ["compose", ...fileArgs, "config"],
            PROCESS_LIMITS.composeValidationMs,
            "compose-validation",
            sink,
            "Compose configuration is valid",
            "Compose configuration is invalid"
          );

    case "apply-start": {
      if (isDockerfile) {
        return {
          ok: false,
          title: "Unsupported action",
          detail: "Apply & Start is only available for Compose projects."
        };
      }

      // Only pass --build when a service actually declares a build context -
      // otherwise this would force an unnecessary rebuild of pure-image
      // services on every start.
      const needsBuild = project.services.some((service) => Boolean(service.sourceHints?.buildContext));
      const args = ["compose", ...fileArgs, "up", "-d", ...(needsBuild ? ["--build"] : [])];

      return runStreamed(
        "docker",
        args,
        PROCESS_LIMITS.composeOperationMs,
        "compose-operation",
        sink,
        "Compose project started",
        "Compose project failed to start"
      );
    }

    case "stop":
      if (isDockerfile) {
        return {
          ok: false,
          title: "Unsupported action",
          detail: "Stop is only available for Compose projects."
        };
      }

      // "Stop" (not "Down"): the button intentionally only halts containers
      // without tearing down networks/volumes, matching its label/confirmation.
      return runStreamed(
        "docker",
        ["compose", ...fileArgs, "stop"],
        PROCESS_LIMITS.composeOperationMs,
        "compose-operation",
        sink,
        "Compose project stopped",
        "Compose project failed to stop"
      );

    case "build-image": {
      if (isDockerfile) {
        const tag = `docker-explorer/${slugifyImageName(project.title)}:dev`;
        const tagCheck = validateImageTag(tag);
        if (!tagCheck.ok) {
          return tagCheck;
        }

        return runStreamed(
          "docker",
          ["build", "-f", configPath, "-t", tag, dirname(configPath)],
          PROCESS_LIMITS.imageBuildMs,
          "docker-build",
          sink,
          `Image built as ${tag}`,
          "Image build failed"
        );
      }

      return runStreamed(
        "docker",
        ["compose", ...fileArgs, "build"],
        PROCESS_LIMITS.imageBuildMs,
        "docker-build",
        sink,
        "Compose build completed",
        "Compose build failed"
      );
    }

    default:
      return {
        ok: false,
        title: "Unsupported action",
        detail: `Action "${String(actionId)}" cannot be executed as a project operation.`
      };
  }
}
