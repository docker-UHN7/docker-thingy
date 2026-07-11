import { describe, expect, it } from "vitest";
import { applyProjectGrouping } from "../src/main/project-service";
import type { ProjectSummary } from "../src/shared/contracts";

function project(id: string, title: string): ProjectSummary {
  return {
    id,
    title,
    subtitle: "Explicitly opened Compose source",
    runtimeKind: "compose",
    access: "editable",
    contextName: "desktop-linux",
    sourcePath: `C:\\projects\\demo\\${title}`,
    configFiles: [`C:\\projects\\demo\\${title}`],
    services: [],
    diagnostics: [],
    actions: [{ id: "validate", label: "Validate" }],
    buildStatus: "not-built",
    lastUpdatedLabel: "Opened from source",
    externalNodes: [],
    relationshipEdges: [],
    sourceLinked: true
  };
}

describe("applyProjectGrouping", () => {
  it("leaves a single project ungrouped", () => {
    const [result] = applyProjectGrouping("C:\\projects\\demo", [project("a", "docker-compose.yml")]);

    expect(result?.groupId).toBeUndefined();
    expect(result?.groupLabel).toBeUndefined();
  });

  it("tags every project from a multi-project folder with a shared groupId and folder-derived label", () => {
    const projects = applyProjectGrouping("C:\\projects\\demo", [
      project("a", "docker-compose-auth.yml"),
      project("b", "docker-compose-payment.yml")
    ]);

    expect(projects.every((p) => p.groupId === "C:\\projects\\demo")).toBe(true);
    expect(projects.every((p) => p.groupLabel === "demo")).toBe(true);
  });

  it("does not mutate the original project objects", () => {
    const original = project("a", "docker-compose-auth.yml");
    applyProjectGrouping("C:\\projects\\demo", [original, project("b", "docker-compose-payment.yml")]);

    expect(original.groupId).toBeUndefined();
  });
});
