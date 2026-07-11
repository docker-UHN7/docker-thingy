import { describe, expect, it } from "vitest";
import type { ProjectSummary, ServiceNodeModel } from "../src/shared/contracts";
import { deriveProjectLifecycle, deriveToolbarActionModel } from "../src/renderer/project-state";

function service(overrides: Partial<ServiceNodeModel> = {}): ServiceNodeModel {
  return {
    id: "service:web",
    name: "web",
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
    ...overrides
  };
}

function project(overrides: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    id: "source-compose:ctx:demo",
    title: "demo",
    subtitle: "source",
    runtimeKind: "compose",
    access: "editable",
    contextName: "desktop-linux",
    sourcePath: "C:\\demo\\compose.yaml",
    configFiles: ["C:\\demo\\compose.yaml"],
    services: [service()],
    diagnostics: [],
    actions: [],
    buildStatus: "not-built",
    lastUpdatedLabel: "Opened from source",
    externalNodes: [],
    relationshipEdges: [],
    sourceLinked: true,
    ...overrides
  };
}

describe("deriveProjectLifecycle", () => {
  it("treats a source-only project as not built and not running", () => {
    expect(deriveProjectLifecycle(project()).state).toBe("not-built");
  });

  it("treats matched running containers as running", () => {
    const runningProject = project({
      buildStatus: "built",
      services: [
        service({
          status: "running",
          categories: { containers: [{ id: "1", shortId: "1", name: "web", status: "Up", running: true }], networks: [], volumes: [] },
          details: {
            containerId: "1",
            env: [],
            mounts: [],
            networks: [],
            labels: {},
            runtimeState: {
              status: "running",
              running: true,
              restarting: false,
              oomKilled: false
            },
            resources: {},
            command: [],
            entrypoint: [],
            ports: []
          }
        })
      ]
    });

    expect(deriveProjectLifecycle(runningProject).state).toBe("running");
    expect(deriveToolbarActionModel(runningProject).primary.label).toBe("Stop");
  });

  it("treats exited containers with errors as crashed", () => {
    const crashedProject = project({
      buildStatus: "built",
      services: [
        service({
          status: "stopped",
          categories: { containers: [{ id: "1", shortId: "1", name: "web", status: "Exited (1)", running: false }], networks: [], volumes: [] },
          details: {
            containerId: "1",
            env: [],
            mounts: [],
            networks: [],
            labels: {},
            runtimeState: {
              status: "exited",
              running: false,
              restarting: false,
              oomKilled: false,
              exitCode: 1,
              error: "boom"
            },
            resources: {},
            command: [],
            entrypoint: [],
            ports: []
          }
        })
      ]
    });

    expect(deriveProjectLifecycle(crashedProject).state).toBe("crashed");
    expect(deriveToolbarActionModel(crashedProject).primary.label).toBe("Rerun");
    expect(deriveToolbarActionModel(crashedProject).secondary?.label).toBe("Rebuild");
  });
});
