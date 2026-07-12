import { describe, expect, it } from "vitest";
import type { ProjectSummary } from "../src/shared/contracts";
import { buildGraph } from "../src/renderer/graph/graph-builder";

describe("buildGraph", () => {
  it("creates stable service nodes and dependency edges", () => {
    const project: ProjectSummary = {
      id: "source-compose:ctx:demo",
      title: "demo",
      subtitle: "Compose source",
      runtimeKind: "compose",
      access: "editable",
      contextName: "desktop-linux",
      configFiles: [],
      services: [
        {
          id: "service:web",
          name: "web",
          status: "running",
          dependencyDetails: [{ serviceName: "api" }],
          dependencies: ["api"],
          ports: [],
          portMappings: [],
          categories: { containers: [], networks: [], volumes: [] },
          declaredNetworks: []
        },
        {
          id: "service:api",
          name: "api",
          status: "running",
          dependencyDetails: [],
          dependencies: [],
          ports: [],
          portMappings: [],
          categories: { containers: [], networks: [], volumes: [] },
          declaredNetworks: []
        }
      ],
      diagnostics: [],
      actions: [],
      buildStatus: "built",
      lastUpdatedLabel: "Now",
      externalNodes: [],
      relationshipEdges: [
        {
          from: "web",
          to: "api",
          kind: "depends_on",
          condition: "service_started",
          inferred: false
        }
      ]
    };

    const graph = buildGraph(project);
    expect(graph.nodes).toHaveLength(2);
    // Dependency edges point from provider to consumer (api -> web), the
    // opposite of depends_on's "web depends on api" reading.
    expect(graph.edges[0]).toMatchObject({ source: "service:api", target: "service:web" });
  });
});
