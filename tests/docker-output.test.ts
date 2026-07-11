import * as z from "zod";
import { describe, expect, it } from "vitest";
import { dedupePortMappings, parseJsonOrJsonLines } from "../src/main/docker-service";

describe("parseJsonOrJsonLines", () => {
  const schema = z.object({ Name: z.string() });

  it("parses JSON arrays", () => {
    const result = parseJsonOrJsonLines('[{"Name":"demo"}]', schema);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual([{ Name: "demo" }]);
    }
  });

  it("parses JSON lines", () => {
    const result = parseJsonOrJsonLines('{"Name":"api"}\n{"Name":"web"}', schema);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(2);
    }
  });

  it("dedupes dual-stack published port bindings with the same host and container ports", () => {
    const result = dedupePortMappings([
      {
        id: "runtime:published:8080:80/tcp",
        hostIp: "0.0.0.0",
        hostPort: "8080",
        containerPort: 80,
        protocol: "tcp",
        state: "published",
        source: "runtime",
        label: "8080 -> 80/tcp"
      },
      {
        id: "runtime:published:8080:80/tcp",
        hostIp: "::",
        hostPort: "8080",
        containerPort: 80,
        protocol: "tcp",
        state: "published",
        source: "runtime",
        label: "8080 -> 80/tcp"
      }
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]?.label).toBe("8080 -> 80/tcp");
  });
});
