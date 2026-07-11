import * as z from "zod";
import { XMLParser } from "fast-xml-parser";
import { PROCESS_LIMITS, execCommand } from "./process-runner";

// All calls target the system libvirt daemon explicitly. The default virsh
// connection (no -c) resolves differently per environment and can fail
// outright even when qemu:///system works fine and is where real VMs live.
const LIBVIRT_URI = "qemu:///system";

export type VmInterface = {
  mac: string;
  model?: string | undefined;
  sourceNetwork?: string | undefined;
  sourceBridge?: string | undefined;
  // libvirt omits <link> entirely when the interface has never been toggled
  // down - absence means up, same as the element's own documented default.
  linkState: "up" | "down";
};

export type VmDomain = {
  name: string;
  uuid: string;
  running: boolean;
  interfaces: VmInterface[];
};

export type VmNetwork = {
  name: string;
  bridge?: string | undefined;
  active: boolean;
  forwardMode?: string | undefined;
};

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (name) => name === "interface"
});

const InterfaceXmlSchema = z.looseObject({
  mac: z.looseObject({ "@_address": z.string().optional() }).optional(),
  source: z
    .looseObject({
      "@_network": z.string().optional(),
      "@_bridge": z.string().optional()
    })
    .optional(),
  model: z.looseObject({ "@_type": z.string().optional() }).optional(),
  link: z.looseObject({ "@_state": z.string().optional() }).optional()
});

const DomainXmlSchema = z.looseObject({
  domain: z
    .looseObject({
      name: z.string().optional(),
      uuid: z.string().optional(),
      devices: z
        .looseObject({
          interface: z.array(InterfaceXmlSchema).optional()
        })
        .optional()
    })
    .optional()
});

const NetworkXmlSchema = z.looseObject({
  network: z
    .looseObject({
      name: z.string().optional(),
      bridge: z.looseObject({ "@_name": z.string().optional() }).optional(),
      forward: z.looseObject({ "@_mode": z.string().optional() }).optional()
    })
    .optional()
});

async function safeVirsh(args: readonly string[]): Promise<string | undefined> {
  try {
    const result = await execCommand("virsh", ["-c", LIBVIRT_URI, ...args], {
      timeoutMs: PROCESS_LIMITS.runtimeDiscoveryMs,
      maxBytes: PROCESS_LIMITS.maxDiagnosticBytes,
      category: "runtime-discovery"
    });
    return result.stdout;
  } catch {
    return undefined;
  }
}

function splitLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function parseDomainXml(xml: string, fallbackName: string, running: boolean): VmDomain | undefined {
  let raw: unknown;
  try {
    raw = xmlParser.parse(xml);
  } catch {
    return undefined;
  }

  const parsed = DomainXmlSchema.safeParse(raw);
  if (!parsed.success || !parsed.data.domain) {
    return undefined;
  }

  const domain = parsed.data.domain;
  const interfaces: VmInterface[] = (domain.devices?.interface ?? []).flatMap((entry) => {
    const mac = entry.mac?.["@_address"];
    if (!mac) {
      return [];
    }

    return [
      {
        mac,
        model: entry.model?.["@_type"],
        sourceNetwork: entry.source?.["@_network"],
        sourceBridge: entry.source?.["@_bridge"],
        linkState: entry.link?.["@_state"] === "down" ? "down" : "up"
      }
    ];
  });

  return {
    name: domain.name ?? fallbackName,
    uuid: domain.uuid ?? fallbackName,
    running,
    interfaces
  };
}

function parseNetInfoActive(infoText: string | undefined): boolean {
  if (!infoText) {
    return false;
  }

  const match = infoText.match(/^Active:\s*(\S+)/m);
  return match?.[1] === "yes";
}

export function parseNetworkXml(
  xml: string,
  fallbackName: string,
  infoText: string | undefined
): VmNetwork | undefined {
  let raw: unknown;
  try {
    raw = xmlParser.parse(xml);
  } catch {
    return undefined;
  }

  const parsed = NetworkXmlSchema.safeParse(raw);
  if (!parsed.success || !parsed.data.network) {
    return undefined;
  }

  const network = parsed.data.network;
  return {
    name: network.name ?? fallbackName,
    bridge: network.bridge?.["@_name"],
    forwardMode: network.forward?.["@_mode"],
    active: parseNetInfoActive(infoText)
  };
}

/** True if `virsh` can reach the system libvirt daemon at all - callers should treat a false result as "no VMs to show," not an error. */
export async function isLibvirtAvailable(): Promise<boolean> {
  return (await safeVirsh(["version"])) !== undefined;
}

export async function listVmDomains(): Promise<VmDomain[]> {
  const allNames = await safeVirsh(["list", "--all", "--name"]);
  if (allNames === undefined) {
    return [];
  }

  const runningNamesOutput = await safeVirsh(["list", "--name"]);
  const runningNames = new Set(splitLines(runningNamesOutput ?? ""));

  const domains: VmDomain[] = [];
  for (const name of splitLines(allNames)) {
    const xml = await safeVirsh(["dumpxml", name]);
    if (xml === undefined) {
      continue;
    }

    const domain = parseDomainXml(xml, name, runningNames.has(name));
    if (domain) {
      domains.push(domain);
    }
  }

  return domains;
}

export async function listVmNetworks(): Promise<VmNetwork[]> {
  const allNames = await safeVirsh(["net-list", "--all", "--name"]);
  if (allNames === undefined) {
    return [];
  }

  const networks: VmNetwork[] = [];
  for (const name of splitLines(allNames)) {
    const xml = await safeVirsh(["net-dumpxml", name]);
    if (xml === undefined) {
      continue;
    }

    const infoText = await safeVirsh(["net-info", name]);
    const network = parseNetworkXml(xml, name, infoText);
    if (network) {
      networks.push(network);
    }
  }

  return networks;
}
