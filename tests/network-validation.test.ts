import { describe, expect, it } from "vitest";
import {
  isValidInterfaceName,
  isValidLibvirtDomainName,
  isValidMacAddress,
  isValidPid
} from "../src/main/validation";

describe("isValidPid", () => {
  it("accepts positive integers as strings", () => {
    expect(isValidPid("1")).toBe(true);
    expect(isValidPid("123456")).toBe(true);
  });

  it("rejects zero, negatives, non-numeric, and non-strings", () => {
    expect(isValidPid("0")).toBe(false);
    expect(isValidPid("-5")).toBe(false);
    expect(isValidPid("12abc")).toBe(false);
    expect(isValidPid("")).toBe(false);
    expect(isValidPid(123)).toBe(false);
    expect(isValidPid(undefined)).toBe(false);
  });
});

describe("isValidInterfaceName", () => {
  it("accepts realistic bridge/veth names", () => {
    expect(isValidInterfaceName("docker0")).toBe(true);
    expect(isValidInterfaceName("virbr0")).toBe(true);
    expect(isValidInterfaceName("br-34b7257c8afa")).toBe(true);
  });

  it("rejects names over IFNAMSIZ-1, empty, or containing shell/nft-meaningful characters", () => {
    expect(isValidInterfaceName("a".repeat(16))).toBe(false);
    expect(isValidInterfaceName("")).toBe(false);
    expect(isValidInterfaceName("br0; rm -rf /")).toBe(false);
    expect(isValidInterfaceName("br0\"")).toBe(false);
    expect(isValidInterfaceName(42)).toBe(false);
  });
});

describe("isValidLibvirtDomainName", () => {
  it("accepts realistic domain names", () => {
    expect(isValidLibvirtDomainName("splunk-lab")).toBe(true);
    expect(isValidLibvirtDomainName("vm_1.test")).toBe(true);
  });

  it("rejects injection attempts and empty input", () => {
    expect(isValidLibvirtDomainName("vm; rm -rf /")).toBe(false);
    expect(isValidLibvirtDomainName("")).toBe(false);
    expect(isValidLibvirtDomainName("-leading-dash")).toBe(false);
  });
});

describe("isValidMacAddress", () => {
  it("accepts standard colon-separated MAC addresses", () => {
    expect(isValidMacAddress("52:54:00:fc:c6:27")).toBe(true);
    expect(isValidMacAddress("AA:BB:CC:DD:EE:FF")).toBe(true);
  });

  it("rejects malformed addresses", () => {
    expect(isValidMacAddress("52:54:00:fc:c6")).toBe(false);
    expect(isValidMacAddress("52-54-00-fc-c6-27")).toBe(false);
    expect(isValidMacAddress("not-a-mac")).toBe(false);
    expect(isValidMacAddress("")).toBe(false);
  });
});
