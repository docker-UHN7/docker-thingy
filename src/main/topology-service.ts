import * as z from "zod";
import { readFile } from "node:fs/promises";
import type { ContainerInspectSchema } from "../shared/contracts";
import type { NetworkTopology, TopologyEdge, TopologyNode } from "../shared/network-contracts";
import {
  dockerNetworkBridgeName,
  listAllContainers,
  listDockerNetworks,
  toContainerDetails,
  toRuntimeContainer,
  type DockerNetworkSummary
} from "./docker-service";
import { isLibvirtAvailable, listVmDomains, listVmNetworks, type VmDomain, type VmNetwork } from "./vm-service";
import { isPolkitAgentRunning } from "./polkit-service";
import { PROCESS_LIMITS, execCommand } from "./process-runner";

// Written by resources/linux/docker-thingy-netctl (root, 0644) after every
// successful container-link/bridge-forward/bridge-link mutation. /run is a
// tmpfs - these overrides have the same "resets on reboot" lifetime as the
// veth/nftables state they're recording. Reading it is the *only* way this
// unprivileged discovery path can reflect a privileged toggle's result on
// the next poll - see readControlState below for why that matters.
const CONTROL_STATE_PATH = "/run/docker-thingy/state.json";

const ControlStateSchema = z.object({
  containerLinks: z.record(z.string(), z.string()).default({}),
  bridgeForwards: z.record(z.string(), z.string()).default({}),
  bridgeLinks: z.record(z.string(), z.string()).default({})
});

export type ControlState = z.infer<typeof ControlStateSchema>;

const EMPTY_CONTROL_STATE: ControlState = { containerLinks: {}, bridgeForwards: {}, bridgeLinks: {} };

/**
 * A missing file (nothing has ever been toggled on this host) or a
 * corrupt/unreadable one are both treated as "no overrides recorded," not an
 * error - discovery should never fail just because this side-channel isn't
 * there yet.
 */
export async function readControlState(): Promise<ControlState> {
  try {
    const raw = await readFile(CONTROL_STATE_PATH, "utf8");
    const parsed = ControlStateSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : EMPTY_CONTROL_STATE;
  } catch {
    return EMPTY_CONTROL_STATE;
  }
}

const IpLinkRecordSchema = z.looseObject({
  ifname: z.string(),
  operstate: z.string().optional()
});

export type HostBridge = {
  name: string;
  up: boolean;
};

async function listHostBridges(): Promise<HostBridge[]> {
  try {
    const result = await execCommand("ip", ["-j", "link", "show", "type", "bridge"], {
      timeoutMs: PROCESS_LIMITS.runtimeDiscoveryMs,
      maxBytes: PROCESS_LIMITS.maxDiagnosticBytes,
      category: "runtime-discovery"
    });

    const parsed = z.array(IpLinkRecordSchema).safeParse(JSON.parse(result.stdout || "[]"));
    if (!parsed.success) {
      return [];
    }

    return parsed.data.map((entry) => ({
      name: entry.ifname,
      up: (entry.operstate ?? "").toUpperCase() === "UP"
    }));
  } catch {
    return [];
  }
}

/** Tracks everything known about one physical bridge as we fold in Docker + libvirt + host data. */
type BridgeAccumulator = {
  name: string;
  hostUp?: boolean | undefined;
  dockerNetworkName?: string | undefined;
  vmNetworkName?: string | undefined;
  forwardMode?: string | undefined;
  hasForwardInfo: boolean;
};

function getOrCreateBridge(map: Map<string, BridgeAccumulator>, name: string): BridgeAccumulator {
  const existing = map.get(name);
  if (existing) {
    return existing;
  }

  const created: BridgeAccumulator = { name, hasForwardInfo: false };
  map.set(name, created);
  return created;
}

/**
 * container-link's targetId is `${containerId}|${mac}` (mirrors vm-link's
 * `${domain}|${mac}` pattern) so the privileged helper can target the right
 * interface on a multi-homed container instead of assuming eth0. Falls back
 * to a bare container id on the rare inspect output where a network
 * attachment has no MAC recorded - network-control-service.ts treats that
 * case as "can't determine which interface" rather than guessing.
 */
function containerLinkTargetId(containerId: string, mac: string | undefined): string {
  return mac ? `${containerId}|${mac}` : containerId;
}

/**
 * Pure merge step, split out from `getNetworkTopology` specifically so it's
 * unit-testable against fixture data without shelling out to
 * docker/virsh/ip. `getNetworkTopology` (below) is the only impure caller.
 */
export function buildTopology(
  containers: z.infer<typeof ContainerInspectSchema>[],
  dockerNetworks: DockerNetworkSummary[],
  hostBridges: HostBridge[],
  vmDomains: VmDomain[],
  vmNetworks: VmNetwork[],
  libvirtAvailable: boolean,
  controlState: ControlState = EMPTY_CONTROL_STATE
): Omit<NetworkTopology, "checkedAt" | "controlAgentAvailable"> {
  const nodes: TopologyNode[] = [];
  const edges: TopologyEdge[] = [];
  const bridges = new Map<string, BridgeAccumulator>();

  for (const bridge of hostBridges) {
    getOrCreateBridge(bridges, bridge.name).hostUp = bridge.up;
  }

  const dockerNetworkBridges = new Map<string, string>();
  for (const network of dockerNetworks) {
    const bridgeName = dockerNetworkBridgeName(network);
    if (!bridgeName) {
      continue;
    }
    dockerNetworkBridges.set(network.name, bridgeName);
    getOrCreateBridge(bridges, bridgeName).dockerNetworkName = network.name;
  }

  const vmNetworkBridges = new Map<string, string>();
  for (const network of vmNetworks) {
    if (!network.bridge) {
      continue;
    }
    vmNetworkBridges.set(network.name, network.bridge);
    const accumulator = getOrCreateBridge(bridges, network.bridge);
    accumulator.vmNetworkName = network.name;
    accumulator.forwardMode = network.forwardMode;
    accumulator.hasForwardInfo = true;
  }

  // Containers
  for (const inspected of containers) {
    const runtime = toRuntimeContainer(inspected);
    const details = toContainerDetails(inspected);
    const nodeId = `container:${runtime.id}`;

    nodes.push({
      id: nodeId,
      kind: "container",
      name: runtime.name,
      status: runtime.running ? "up" : "down",
      detail: runtime.image
    });

    for (const network of details.networks) {
      const bridgeName = dockerNetworkBridges.get(network.name);
      if (!bridgeName) {
        continue;
      }

      getOrCreateBridge(bridges, bridgeName);
      const actionTargetId = containerLinkTargetId(runtime.id, network.macAddress);
      edges.push({
        id: `attach:${nodeId}:${bridgeName}`,
        from: nodeId,
        to: `bridge:${bridgeName}`,
        kind: "attachment",
        state: controlState.containerLinks[actionTargetId] ? "down" : "up",
        // Docker clears MacAddress (and the container's PID, which
        // container-link also needs) once a container is stopped, so there's
        // no live interface to target - disable the click affordance instead
        // of letting the user hit a confusing error after confirming.
        controllable: Boolean(network.macAddress),
        verb: "container-link",
        actionTargetId
      });
    }
  }

  // VMs
  for (const domain of vmDomains) {
    const nodeId = `vm:${domain.name}`;

    nodes.push({
      id: nodeId,
      kind: "vm",
      name: domain.name,
      status: domain.running ? "up" : "down",
      detail: domain.running ? "running" : "shut off"
    });

    for (const iface of domain.interfaces) {
      const bridgeName = iface.sourceBridge ?? (iface.sourceNetwork ? vmNetworkBridges.get(iface.sourceNetwork) : undefined);
      if (!bridgeName) {
        continue;
      }

      getOrCreateBridge(bridges, bridgeName);
      edges.push({
        id: `attach:${nodeId}:${iface.mac}:${bridgeName}`,
        from: nodeId,
        to: `bridge:${bridgeName}`,
        kind: "attachment",
        state: iface.linkState,
        controllable: true,
        verb: "vm-link",
        actionTargetId: `${domain.name}|${iface.mac}`
      });
    }
  }

  // Bridges + their uplink (a bridge's route to the rest of the network/internet)
  for (const bridge of bridges.values()) {
    const bridgeNodeId = `bridge:${bridge.name}`;
    const label = bridge.dockerNetworkName ?? bridge.vmNetworkName;

    nodes.push({
      id: bridgeNodeId,
      kind: "bridge",
      name: label ? `${bridge.name} (${label})` : bridge.name,
      status: bridge.hostUp === undefined ? "unknown" : bridge.hostUp ? "up" : "down"
    });

    // Docker bridge networks masquerade to the outside by default; libvirt
    // networks only do so when they declare a <forward> mode (nat/route) -
    // an isolated libvirt network has none, so treat that as already "down"
    // rather than guessing "up". An explicit recorded "deny" always wins
    // over either guess - it's a real user action, not a default.
    const discoveredUplinkState: "up" | "down" = bridge.hasForwardInfo ? (bridge.forwardMode ? "up" : "down") : "up";
    const uplinkState: "up" | "down" = controlState.bridgeForwards[bridge.name] ? "down" : discoveredUplinkState;

    const uplinkNodeId = `uplink:${bridge.name}`;
    nodes.push({
      id: uplinkNodeId,
      kind: "uplink",
      name: "Internet / LAN",
      status: uplinkState
    });

    edges.push({
      id: `uplink:${bridge.name}`,
      from: bridgeNodeId,
      to: uplinkNodeId,
      kind: "uplink",
      state: uplinkState,
      controllable: true,
      verb: "bridge-forward",
      actionTargetId: bridge.name
    });
  }

  // Bridge-to-bridge interconnects: these have no other discovery path at
  // all (reading nftables rules needs the same root privilege as writing
  // them), so the state file is their *only* source of truth, not just an
  // override on top of a guessed default.
  for (const key of Object.keys(controlState.bridgeLinks)) {
    const separatorIndex = key.indexOf("|");
    if (separatorIndex === -1) {
      continue;
    }

    const first = key.slice(0, separatorIndex);
    const second = key.slice(separatorIndex + 1);
    if (!bridges.has(first) || !bridges.has(second)) {
      // Stale entry (e.g. one of the bridges no longer exists) - skip rather
      // than synthesize an edge between nodes we're not otherwise showing.
      continue;
    }

    edges.push({
      id: `link:${first}:${second}`,
      from: `bridge:${first}`,
      to: `bridge:${second}`,
      kind: "interconnect",
      state: "up",
      controllable: true,
      verb: "bridge-link",
      actionTargetId: key
    });
  }

  return {
    nodes,
    edges,
    warning: libvirtAvailable ? undefined : "libvirt was not reachable - showing Docker-only topology."
  };
}

export async function getNetworkTopology(): Promise<NetworkTopology> {
  const [containers, dockerNetworks, hostBridges, libvirtAvailable, controlAgentAvailable, controlState] =
    await Promise.all([
      listAllContainers(),
      listDockerNetworks(),
      listHostBridges(),
      isLibvirtAvailable(),
      isPolkitAgentRunning(),
      readControlState()
    ]);

  const [vmDomains, vmNetworks] = libvirtAvailable
    ? await Promise.all([listVmDomains(), listVmNetworks()])
    : [[], []];

  return {
    ...buildTopology(containers, dockerNetworks, hostBridges, vmDomains, vmNetworks, libvirtAvailable, controlState),
    checkedAt: new Date().toISOString(),
    controlAgentAvailable
  };
}
