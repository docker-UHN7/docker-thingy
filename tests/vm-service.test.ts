import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDomainXml, parseNetworkXml } from "../src/main/vm-service";

function fixture(name: string): string {
  return readFileSync(join(__dirname, "fixtures", name), "utf8");
}

describe("parseDomainXml", () => {
  it("extracts network- and bridge-attached interfaces", () => {
    const domain = parseDomainXml(fixture("vm-domain.xml"), "fallback", true);

    expect(domain).toMatchObject({
      name: "splunk-lab",
      uuid: "e218c8f4-7601-46a4-a963-85aee31e62cd",
      running: true
    });
    expect(domain?.interfaces).toEqual([
      { mac: "52:54:00:fc:c6:27", model: "virtio", sourceNetwork: "default", sourceBridge: undefined, linkState: "up" },
      { mac: "52:54:00:aa:bb:cc", model: "virtio", sourceNetwork: undefined, sourceBridge: "br-lan", linkState: "up" }
    ]);
  });

  it("treats an absent <link> element as up (libvirt's own documented default)", () => {
    const domain = parseDomainXml(fixture("vm-domain-single-interface.xml"), "fallback", false);
    expect(domain?.interfaces[0]?.linkState).toBe("up");
  });

  it("reads an explicit <link state='down'/> element", () => {
    const domain = parseDomainXml(fixture("vm-domain-link-down.xml"), "fallback", true);
    expect(domain?.interfaces[0]?.linkState).toBe("down");
  });

  it("wraps a single interface in an array just like multiple interfaces", () => {
    const domain = parseDomainXml(fixture("vm-domain-single-interface.xml"), "fallback", false);

    expect(domain?.interfaces).toHaveLength(1);
    expect(domain?.interfaces[0]).toMatchObject({ mac: "52:54:00:11:22:33", sourceNetwork: "default" });
  });

  it("falls back to the provided name/running state when parsing fails", () => {
    const domain = parseDomainXml("not xml at all <<<", "some-domain", false);
    expect(domain).toBeUndefined();
  });
});

describe("parseNetworkXml", () => {
  it("reads the bridge name and forward mode, and active state from net-info text", () => {
    const network = parseNetworkXml(fixture("vm-network.xml"), "fallback", "Active:         yes\nAutostart:      yes\n");

    expect(network).toEqual({
      name: "default",
      bridge: "virbr0",
      forwardMode: "nat",
      active: true
    });
  });

  it("treats a network with no <forward> element as having no forward mode", () => {
    const network = parseNetworkXml(fixture("vm-network-isolated.xml"), "fallback", "Active:         no\n");

    expect(network).toEqual({
      name: "isolated",
      bridge: "virbr1",
      forwardMode: undefined,
      active: false
    });
  });

  it("treats missing net-info text as inactive", () => {
    const network = parseNetworkXml(fixture("vm-network.xml"), "fallback", undefined);
    expect(network?.active).toBe(false);
  });
});
