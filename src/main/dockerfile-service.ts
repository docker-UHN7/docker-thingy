import { readFile } from "node:fs/promises";
import type { BuildTarget, ProjectSummary, ValidationOutcome } from "../shared/contracts";

export function parseBuildxTargets(text: string): { targets: BuildTarget[]; raw: string; warning?: string } {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);

  if (lines.length <= 1) {
    return {
      targets: [],
      raw: text,
      warning: "Stage list could not be interpreted"
    };
  }

  const targets: BuildTarget[] = [];

  for (const line of lines.slice(1)) {
    const parts = line.trim().split(/\s+/);
    const firstToken = parts[0];
    if (!firstToken) {
      continue;
    }

    const isDefault = line.includes("(default)");
    const description = line.replace(firstToken, "").replace("(default)", "").trim();

    targets.push({
      name: firstToken,
      isDefault,
      description: description || undefined
    });
  }

  if (targets.length === 0) {
    return {
      targets,
      raw: text,
      warning: "Stage list could not be interpreted"
    };
  }

  return {
    targets,
    raw: text
  };
}

export function validateImageTag(tag: string): ValidationOutcome {
  if (!/^[a-z0-9]+([._/-][a-z0-9]+)*(?::[\w][\w.-]{0,127})?$/i.test(tag)) {
    return {
      ok: false,
      title: "Invalid image tag",
      detail: "Use a conventional Docker image tag such as my-app:dev."
    };
  }

  return {
    ok: true,
    title: "Image tag looks valid",
    detail: "The configured image tag can be used for buildx --load builds."
  };
}

export async function loadDockerfileProject(sourcePath: string, contextName: string): Promise<ProjectSummary> {
  const sourceText = await readFile(sourcePath, "utf8");
  const stageCount = sourceText
    .split(/\r?\n/)
    .filter((line) => line.trim().toUpperCase().startsWith("FROM ")).length;

  return {
    id: `source-dockerfile:${contextName}:${sourcePath}`,
    title: sourcePath.split(/[/\\]/).at(-1) ?? "Dockerfile",
    subtitle: "Explicitly opened Dockerfile source",
    runtimeKind: "dockerfile",
    access: "editable",
    contextName,
    composeProjectName: undefined,
    sourcePath,
    configFiles: [sourcePath],
    services: [
      {
        id: `dockerfile:${sourcePath}`,
        name: "Docker build",
        image: "configured via sidecar settings",
        status: "unknown",
        dependencies: [],
        dependencyDetails: [],
        ports: [],
        portMappings: [],
        categories: {
          containers: [],
          networks: [],
          volumes: []
        },
        declaredNetworks: [],
        sourceHints: {
          dockerfilePath: sourcePath
        }
      }
    ],
    diagnostics: [
      {
        level: "info",
        title: "Build stages detected",
        message: `${stageCount} Dockerfile stage${stageCount === 1 ? "" : "s"} detected.`
      }
    ],
    actions: [
      { id: "validate", label: "Validate", emphasis: "primary" },
      { id: "build-image", label: "Build image", confirmation: "Build an image from this Dockerfile?" }
    ],
    buildStatus: "not-built",
    lastUpdatedLabel: "Opened from source",
    lastCheckedAt: new Date().toISOString(),
    externalNodes: [],
    relationshipEdges: [],
    sourceLinked: true
  };
}
