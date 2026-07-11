import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadComposeProject } from "../src/main/compose-service";

const fixturesDir = join(process.cwd(), "tests", "fixtures");

describe("loadComposeProject list-form parsing", () => {
  // yaml's Collection#get() returns YAMLSeq/YAMLMap node instances (not plain
  // arrays/objects) regardless of the keepScalar flag - only bare Scalars get
  // unwrapped. Every declared list field (ports, expose, depends_on as a
  // list, networks, volumes) is read this way, so a bare `Array.isArray(...)`
  // check against the result silently treated every one of these as absent.
  it("parses declared ports, expose, list-form depends_on, networks, and volumes", async () => {
    const project = await loadComposeProject(join(fixturesDir, "compose-lists.yaml"), "desktop-linux");
    const web = project.services.find((service) => service.name === "web");
    const api = project.services.find((service) => service.name === "api");

    expect(web).toBeDefined();
    expect(api).toBeDefined();

    // ports: (published, string form)
    expect(web?.portMappings.some((port) => port.label === "8080 -> 80/tcp")).toBe(true);
    // expose:
    expect(web?.portMappings.some((port) => port.label === "9000/tcp")).toBe(true);
    // depends_on as a plain list
    expect(web?.dependencyDetails).toEqual([{ serviceName: "api" }]);
    // depends_on as a map with a condition
    expect(api?.dependencyDetails).toEqual([{ serviceName: "db", condition: "service_healthy" }]);
    // networks: as a plain list
    expect(web?.declaredNetworks.sort()).toEqual(["backend", "frontend"]);
    expect(web?.categories.networks.sort()).toEqual(["backend", "frontend"]);
    // volumes: as a plain list (named volume + bind mount)
    expect(web?.categories.volumes).toEqual(["webdata"]);
    expect(api?.categories.volumes).toEqual(["./local"]);
  });

  it("resolves a string-form build context (not just the object form)", async () => {
    const project = await loadComposeProject(join(fixturesDir, "compose-lists.yaml"), "desktop-linux");
    const web = project.services.find((service) => service.name === "web");

    expect(web?.sourceHints?.buildContext).toBe("./web");
  });

  it("builds network and depends_on relationship edges from the parsed lists", async () => {
    const project = await loadComposeProject(join(fixturesDir, "compose-lists.yaml"), "desktop-linux");

    expect(
      project.relationshipEdges.some(
        (edge) => edge.kind === "depends_on" && edge.from === "web" && edge.to === "api"
      )
    ).toBe(true);
    expect(
      project.relationshipEdges.some(
        (edge) => edge.kind === "network" && edge.label === "backend" && [edge.from, edge.to].includes("api") && [edge.from, edge.to].includes("db")
      )
    ).toBe(true);
  });
});
