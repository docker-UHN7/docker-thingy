import { dirname } from "node:path";
import type { ExecutableProjectActionId, OperationStream, ProjectSummary, ValidationOutcome } from "../shared/contracts";
import { validateImageTag } from "./dockerfile-service";
import { execCommand, PROCESS_LIMITS, streamCommand, type CommandCategory } from "./process-runner";

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

// Every active compose file becomes its own -f flag (in order), not just the
// project's primary/anchor file - this is what lets a checked-on override
// file actually take effect when a project has more than one active config.
function composeArgs(project: ProjectSummary, configPath: string, command: string, extraArgs: readonly string[] = []): string[] {
  const projectNameArgs = project.composeProjectName ? ["--project-name", project.composeProjectName] : [];
  const configFiles = project.configFiles.length > 0 ? project.configFiles : [configPath];
  const fileArgs = configFiles.flatMap((file) => ["-f", file]);
  return ["compose", ...projectNameArgs, ...fileArgs, command, ...extraArgs];
}

type RuntimeContainerRecord = {
  id: string;
  name: string;
  state: string;
  composeProjectName?: string | undefined;
};

async function findRuntimeContainers(project: ProjectSummary): Promise<RuntimeContainerRecord[]> {
  const filters: string[] = [];

  if (project.composeProjectName) {
    filters.push(`label=com.docker.compose.project=${project.composeProjectName}`);
  }

  if (project.services.some((service) => service.details?.containerId)) {
    const ids = project.services
      .map((service) => service.details?.containerId)
      .filter((value): value is string => Boolean(value));

    if (ids.length > 0) {
      const inspected = await execCommand("docker", ["inspect", "--type", "container", ...ids], {
        timeoutMs: PROCESS_LIMITS.runtimeDiscoveryMs,
        maxBytes: PROCESS_LIMITS.maxJsonBytes,
        category: "runtime-discovery"
      });

      const parsed = JSON.parse(inspected.stdout) as Array<{
        Id?: string;
        Name?: string;
        Config?: { Labels?: Record<string, string> };
        State?: { Status?: string };
      }>;

      return parsed
        .filter((entry): entry is { Id: string; Name?: string; Config?: { Labels?: Record<string, string> }; State?: { Status?: string } } => Boolean(entry.Id))
        .map((entry) => ({
          id: entry.Id,
          name: entry.Name?.replace(/^\//, "") ?? entry.Id.slice(0, 12),
          state: entry.State?.Status ?? "unknown",
          composeProjectName: entry.Config?.Labels?.["com.docker.compose.project"]
        }))
        .filter((entry) => !project.composeProjectName || entry.composeProjectName === project.composeProjectName);
    }
  }

  if (filters.length === 0) {
    return [];
  }

  const args = ["ps", "--all"];
  for (const filter of filters) {
    args.push("--filter", filter);
  }
  args.push("--format", "{{json .}}");

  const listed = await execCommand("docker", args, {
    timeoutMs: PROCESS_LIMITS.runtimeDiscoveryMs,
    maxBytes: PROCESS_LIMITS.maxJsonBytes,
    category: "runtime-discovery"
  });

  return listed.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as { ID?: string; Names?: string; State?: string; Labels?: string };
      } catch {
        return undefined;
      }
    })
    .filter((entry): entry is { ID?: string; Names?: string; State?: string; Labels?: string } => Boolean(entry))
    .filter((entry): entry is { ID: string; Names?: string; State?: string; Labels?: string } => Boolean(entry.ID))
    .map((entry) => ({
      id: entry.ID,
      name: entry.Names ?? entry.ID.slice(0, 12),
      state: entry.State ?? "unknown"
    }));
}

async function verifyContainersStopped(project: ProjectSummary): Promise<ValidationOutcome | undefined> {
  const containers = await findRuntimeContainers(project);
  const stillRunning = containers.filter((container) => container.state.toLowerCase() === "running");

  if (stillRunning.length === 0) {
    return undefined;
  }

  return {
    ok: false,
    title: "Compose project is still running",
    detail: `Docker still reports these containers as running: ${stillRunning.map((container) => container.name).join(", ")}.`
  };
}

async function verifyContainersRunningById(containerIds: readonly string[]): Promise<ValidationOutcome | undefined> {
  if (containerIds.length === 0) {
    return {
      ok: false,
      title: "No containers available to start",
      detail: "Docker did not report any existing containers for this project."
    };
  }

  const inspected = await execCommand("docker", ["inspect", "--type", "container", ...containerIds], {
    timeoutMs: PROCESS_LIMITS.runtimeDiscoveryMs,
    maxBytes: PROCESS_LIMITS.maxJsonBytes,
    category: "runtime-discovery"
  });

  const parsed = JSON.parse(inspected.stdout) as Array<{
    Id?: string;
    Name?: string;
    State?: { Running?: boolean; Status?: string };
  }>;

  const notRunning = parsed.filter((entry) => !entry.State?.Running);
  if (notRunning.length === 0) {
    return undefined;
  }

  return {
    ok: false,
    title: "Compose project did not start",
    detail: `Docker still reports these containers as not running: ${notRunning
      .map((entry) => entry.Name?.replace(/^\//, "") ?? entry.Id ?? "unknown")
      .join(", ")}.`
  };
}

async function verifyComposeRunningState(
  project: ProjectSummary,
  configPath: string,
  shouldBeRunning: boolean
): Promise<ValidationOutcome | undefined> {
  const result = await execCommand("docker", composeArgs(project, configPath, "ps", ["--format", "json"]), {
    timeoutMs: PROCESS_LIMITS.runtimeDiscoveryMs,
    maxBytes: PROCESS_LIMITS.maxJsonBytes,
    category: "runtime-discovery"
  });

  const records = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as { Name?: string; State?: string };
      } catch {
        return undefined;
      }
    })
    .filter((entry): entry is { Name?: string; State?: string } => Boolean(entry));

  const anyRunning = records.some((record) => (record.State ?? "").toLowerCase() === "running");

  if (shouldBeRunning && !anyRunning) {
    return {
      ok: false,
      title: "Compose project did not start",
      detail: "Docker reported no running containers for this project after the start command completed."
    };
  }

  if (!shouldBeRunning && anyRunning) {
    return {
      ok: false,
      title: "Compose project is still running",
      detail: "The stop command completed, but Docker still reports one or more containers as running for this project."
    };
  }

  return undefined;
}

async function stopRuntimeContainers(project: ProjectSummary, sink: OperationSink): Promise<ValidationOutcome | undefined> {
  const containers = await findRuntimeContainers(project);
  const runningContainers = containers.filter((container) => container.state.toLowerCase() === "running");

  if (runningContainers.length === 0) {
    sink("stdout", "Docker reports no running containers for this project.");
    return undefined;
  }

  sink("stdout", `Stopping ${runningContainers.length} running container(s): ${runningContainers.map((container) => container.name).join(", ")}`);

  const stopResult = await execCommand("docker", ["stop", ...runningContainers.map((container) => container.id)], {
    timeoutMs: PROCESS_LIMITS.composeOperationMs,
    maxBytes: PROCESS_LIMITS.maxDiagnosticBytes,
    category: "compose-operation"
  });

  for (const line of [stopResult.stdout, stopResult.stderr].join("\n").split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean)) {
    sink("stdout", line);
  }

  if (stopResult.exitCode !== 0) {
    return {
      ok: false,
      title: "Container stop failed",
      detail: stopResult.stderr.trim() || stopResult.stdout.trim() || "Docker stop did not complete successfully."
    };
  }

  return verifyContainersStopped(project);
}

async function startRuntimeContainers(project: ProjectSummary, sink: OperationSink): Promise<ValidationOutcome | undefined> {
  const containers = await findRuntimeContainers(project);
  const stoppedContainers = containers.filter((container) => container.state.toLowerCase() !== "running");

  if (stoppedContainers.length === 0) {
    sink("stdout", "Docker reports no existing stopped containers for this project.");
    return undefined;
  }

  sink(
    "stdout",
    `Starting ${stoppedContainers.length} existing container(s): ${stoppedContainers.map((container) => container.name).join(", ")}`
  );

  const startResult = await execCommand("docker", ["start", ...stoppedContainers.map((container) => container.id)], {
    timeoutMs: PROCESS_LIMITS.composeOperationMs,
    maxBytes: PROCESS_LIMITS.maxDiagnosticBytes,
    category: "compose-operation"
  });

  for (const line of [startResult.stdout, startResult.stderr].join("\n").split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean)) {
    sink("stdout", line);
  }

  if (startResult.exitCode !== 0) {
    return {
      ok: false,
      title: "Container start failed",
      detail: startResult.stderr.trim() || startResult.stdout.trim() || "Docker start did not complete successfully."
    };
  }

  return verifyContainersRunningById(stoppedContainers.map((container) => container.id));
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
  const configPath = project.sourcePath ?? project.configFiles[0];
  const isDockerfile = project.runtimeKind === "dockerfile";

  if (!configPath) {
    return {
      ok: false,
      title: "No source file available",
      detail: "This project has no resolvable Compose file or Dockerfile path to operate on."
    };
  }

  switch (actionId) {
    case "validate":
      return isDockerfile
        ? runStreamed(
            "docker",
            ["build", "--progress", "plain", "-f", configPath, dirname(configPath)],
            PROCESS_LIMITS.imageBuildMs,
            "docker-build",
            sink,
            "Dockerfile validation passed",
            "Dockerfile validation failed"
          )
        : runStreamed(
            "docker",
            composeArgs(project, configPath, "build", ["--progress", "plain"]),
            PROCESS_LIMITS.imageBuildMs,
            "docker-build",
            sink,
            "Compose build validation passed",
            "Compose build validation failed"
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
      const args = composeArgs(project, configPath, "up", ["-d", ...(needsBuild ? ["--build"] : [])]);

      const outcome = await runStreamed(
        "docker",
        args,
        PROCESS_LIMITS.composeOperationMs,
        "compose-operation",
        sink,
        "Compose project started",
        "Compose project failed to start"
      );

      if (!outcome.ok) {
        return outcome;
      }

      return (await verifyComposeRunningState(project, configPath, true)) ?? outcome;
    }

    case "start": {
      if (isDockerfile) {
        return {
          ok: false,
          title: "Unsupported action",
          detail: "Start is only available for Compose projects."
        };
      }

      const existingContainers = await findRuntimeContainers(project);
      if (existingContainers.length > 0) {
        const directStartOutcome = await startRuntimeContainers(project, sink);
        return directStartOutcome ?? {
          ok: true,
          title: "Compose project started",
          detail: "Existing project containers were started."
        };
      }

      const outcome = await runStreamed(
        "docker",
        composeArgs(project, configPath, "up", ["-d"]),
        PROCESS_LIMITS.composeOperationMs,
        "compose-operation",
        sink,
        "Compose project started",
        "Compose project failed to start"
      );

      if (!outcome.ok) {
        return outcome;
      }

      return (await verifyComposeRunningState(project, configPath, true)) ?? outcome;
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
      const outcome = await runStreamed(
        "docker",
        composeArgs(project, configPath, "stop"),
        PROCESS_LIMITS.composeOperationMs,
        "compose-operation",
        sink,
        "Compose project stopped",
        "Compose project failed to stop"
      );

      if (!outcome.ok) {
        return outcome;
      }

      const composeVerification = await verifyComposeRunningState(project, configPath, false);
      if (!composeVerification) {
        return outcome;
      }

      sink("stderr", composeVerification.detail);

      const directStopOutcome = await stopRuntimeContainers(project, sink);
      return directStopOutcome ?? outcome;

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
        composeArgs(project, configPath, "build"),
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
