import type { ExecutableProjectActionId, ProjectSummary } from "../shared/contracts";

export type ProjectLifecycleState = "not-built" | "built-not-running" | "running" | "crashed";

export type ProjectLifecycle = {
  state: ProjectLifecycleState;
  hasRuntimeMatch: boolean;
  isRunning: boolean;
  isCrashed: boolean;
  isBuilt: boolean;
};

export type ToolbarActionModel = {
  primary: {
    label: string;
    actionId: ExecutableProjectActionId;
  };
  secondary?:
    | {
        label: string;
        actionId: ExecutableProjectActionId;
      }
    | undefined;
};

function hasBuildError(project: ProjectSummary): boolean {
  return project.services.some((service) => {
    const runtimeState = service.details?.runtimeState;
    return Boolean(
      runtimeState &&
        !runtimeState.running &&
        ((runtimeState.exitCode !== undefined && runtimeState.exitCode > 0) || runtimeState.error)
    );
  });
}

export function deriveProjectLifecycle(project: ProjectSummary): ProjectLifecycle {
  const hasRuntimeMatch = project.services.some(
    (service) => service.categories.containers.length > 0 || Boolean(service.details?.containerId)
  );
  const isRunning = project.services.some((service) =>
    service.status === "running" || service.status === "starting" || service.status === "unhealthy"
  );
  const isCrashed = hasRuntimeMatch && !isRunning && hasBuildError(project);
  const isBuilt = project.buildStatus === "built" || hasRuntimeMatch;

  if (isRunning) {
    return { state: "running", hasRuntimeMatch, isRunning, isCrashed: false, isBuilt: true };
  }

  if (isCrashed) {
    return { state: "crashed", hasRuntimeMatch, isRunning: false, isCrashed: true, isBuilt: true };
  }

  if (isBuilt) {
    return { state: "built-not-running", hasRuntimeMatch, isRunning: false, isCrashed: false, isBuilt: true };
  }

  return { state: "not-built", hasRuntimeMatch, isRunning: false, isCrashed: false, isBuilt: false };
}

export function deriveToolbarActionModel(project: ProjectSummary): ToolbarActionModel {
  const lifecycle = deriveProjectLifecycle(project);

  switch (lifecycle.state) {
    case "running":
      return {
        primary: { label: "Stop", actionId: "stop" }
      };
    case "crashed":
      return {
        primary: { label: "Rerun", actionId: "start" },
        secondary: { label: "Rebuild", actionId: "build-image" }
      };
    case "built-not-running":
      return {
        primary: { label: "Start", actionId: "start" },
        secondary: { label: "Rebuild", actionId: "build-image" }
      };
    case "not-built":
    default:
      return {
        primary: { label: "Build", actionId: "build-image" },
        secondary: { label: "Build & Start", actionId: "apply-start" }
      };
  }
}
