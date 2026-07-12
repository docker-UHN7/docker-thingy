import { describe, expect, it } from "vitest";
import { applyServiceFieldEdits, readServiceFields } from "../src/main/compose-service";

describe("readServiceFields", () => {
  it("reads a fully-populated service into a flat, editable shape", () => {
    const source = `services:
  api:
    image: api:latest
    restart: unless-stopped
    ports:
      - "8080:80"
      - "9090:90"
    volumes:
      - api-data:/data
    depends_on:
      - postgres
    environment:
      NODE_ENV: production
      DEBUG: "true"
`;

    const fields = readServiceFields(source, "api");
    expect(fields).toEqual({
      image: "api:latest",
      restart: "unless-stopped",
      ports: ["8080:80", "9090:90"],
      volumes: ["api-data:/data"],
      dependsOn: ["postgres"],
      environment: { NODE_ENV: "production", DEBUG: "true" }
    });
  });

  it("normalizes list-form environment (KEY=value) into a flat map", () => {
    const source = "services:\n  api:\n    image: api:latest\n    environment:\n      - NODE_ENV=production\n      - EMPTY=\n";

    const fields = readServiceFields(source, "api");
    expect(fields?.environment).toEqual({ NODE_ENV: "production", EMPTY: "" });
  });

  it("normalizes map-form (long syntax) depends_on into a flat name list", () => {
    const source =
      "services:\n  api:\n    image: api:latest\n    depends_on:\n      postgres:\n        condition: service_healthy\n";

    const fields = readServiceFields(source, "api");
    expect(fields?.dependsOn).toEqual(["postgres"]);
  });

  it("returns defaults for a minimal service with no optional fields", () => {
    const source = "services:\n  api:\n    image: api:latest\n";

    const fields = readServiceFields(source, "api");
    expect(fields).toEqual({
      image: "api:latest",
      restart: "",
      ports: [],
      volumes: [],
      dependsOn: [],
      environment: {}
    });
  });

  it("returns undefined for a service that doesn't exist", () => {
    const source = "services:\n  api:\n    image: api:latest\n";
    expect(readServiceFields(source, "does-not-exist")).toBeUndefined();
  });
});

describe("applyServiceFieldEdits", () => {
  it("replaces image, restart, ports, volumes, depends_on, and environment", () => {
    const source = "services:\n  api:\n    image: api:old\n";

    const result = applyServiceFieldEdits(source, "api", {
      image: "api:new",
      restart: "always",
      ports: ["8080:80"],
      volumes: ["api-data:/data"],
      dependsOn: ["postgres"],
      environment: { NODE_ENV: "production" }
    });

    const fields = readServiceFields(result.sourceText, "api");
    expect(fields).toEqual({
      image: "api:new",
      restart: "always",
      ports: ["8080:80"],
      volumes: ["api-data:/data"],
      dependsOn: ["postgres"],
      environment: { NODE_ENV: "production" }
    });
  });

  it("deletes a field's YAML key entirely when set to an empty list/map/string", () => {
    const source =
      "services:\n  api:\n    image: api:latest\n    restart: always\n    ports:\n      - \"8080:80\"\n    depends_on:\n      - postgres\n    environment:\n      NODE_ENV: production\n";

    const result = applyServiceFieldEdits(source, "api", {
      restart: "",
      ports: [],
      dependsOn: [],
      environment: {}
    });

    expect(result.sourceText).not.toContain("restart");
    expect(result.sourceText).not.toContain("ports");
    expect(result.sourceText).not.toContain("depends_on");
    expect(result.sourceText).not.toContain("environment");
    expect(result.sourceText).toContain("image: api:latest");
  });

  it("leaves fields not present in the edit untouched", () => {
    const source = "services:\n  api:\n    image: api:latest\n    restart: always\n    ports:\n      - \"8080:80\"\n";

    const result = applyServiceFieldEdits(source, "api", { image: "api:new" });

    expect(result.sourceText).toContain("restart: always");
    expect(result.sourceText).toContain("8080:80");
    expect(result.sourceText).toContain("image: api:new");
  });
});
