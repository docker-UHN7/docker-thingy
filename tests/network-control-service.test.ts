import { describe, expect, it } from "vitest";
import { parseBridgeLinkTargetId, parseContainerLinkTargetId, parseVmLinkTargetId } from "../src/main/network-control-service";

describe("parseVmLinkTargetId", () => {
  it("splits on the last '|' so a domain name containing '|' still parses (MAC never does)", () => {
    expect(parseVmLinkTargetId("splunk-lab|52:54:00:fc:c6:27")).toEqual({
      domain: "splunk-lab",
      mac: "52:54:00:fc:c6:27"
    });
    expect(parseVmLinkTargetId("weird|name|52:54:00:fc:c6:27")).toEqual({
      domain: "weird|name",
      mac: "52:54:00:fc:c6:27"
    });
  });

  it("throws on a target id with no separator", () => {
    expect(() => parseVmLinkTargetId("no-separator-here")).toThrow();
  });
});

describe("parseContainerLinkTargetId", () => {
  it("splits a containerId|mac target id", () => {
    expect(parseContainerLinkTargetId("abc123|52:54:00:fc:c6:27")).toEqual({
      containerId: "abc123",
      mac: "52:54:00:fc:c6:27"
    });
  });

  it("returns an undefined mac (not a throw) for a bare container id, so the caller can surface a domain-specific error", () => {
    expect(parseContainerLinkTargetId("abc123")).toEqual({
      containerId: "abc123",
      mac: undefined
    });
  });
});

describe("parseBridgeLinkTargetId", () => {
  it("splits a bridgeA|bridgeB target id", () => {
    expect(parseBridgeLinkTargetId("docker0|virbr0")).toEqual({
      bridgeA: "docker0",
      bridgeB: "virbr0"
    });
  });

  it("throws on a target id with no separator", () => {
    expect(() => parseBridgeLinkTargetId("no-separator-here")).toThrow();
  });
});
