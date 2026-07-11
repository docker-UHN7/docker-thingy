import * as z from "zod";
import type { ContainerInspectSchema } from "../shared/contracts";
import type { NetworkActionVerb, NetworkTopology, TopologyEdge, TopologyNode } from "../shared/network-contracts";
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
  libvirtAvailable: boolean
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
      edges.push({
        id: `attach:${nodeId}:${bridgeName}`,
        from: nodeId,
        to: `bridge:${bridgeName}`,
        kind: "attachment",
        state: "up",
        controllable: true,
        verb: "container-link",
        actionTargetId: runtime.id
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
        state: "up",
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
    // rather than guessing "up".
    const uplinkState: "up" | "down" = bridge.hasForwardInfo ? (bridge.forwardMode ? "up" : "down") : "up";

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

  return {
    nodes,
    edges,
    warning: libvirtAvailable ? undefined : "libvirt was not reachable - showing Docker-only topology."
  };
}

export async function getNetworkTopology(): Promise<NetworkTopology> {
  const [containers, dockerNetworks, hostBridges, libvirtAvailable, controlAgentAvailable] = await Promise.all([
    listAllContainers(),
    listDockerNetworks(),
    listHostBridges(),
    isLibvirtAvailable(),
    isPolkitAgentRunning()
  ]);

  const [vmDomains, vmNetworks] = libvirtAvailable
    ? await Promise.all([listVmDomains(), listVmNetworks()])
    : [[], []];

  return {
    ...buildTopology(containers, dockerNetworks, hostBridges, vmDomains, vmNetworks, libvirtAvailable),
    checkedAt: new Date().toISOString(),
    controlAgentAvailable
  };
}

/**
 * Patches a just-toggled edge's state (and, for a bridge-forward toggle, its
 * uplink node's status) onto a fresh topology read.
 *
 * This is necessary, not just an optimization: reading whether a veth or
 * nftables rule is administratively down requires the same root privilege as
 * setting it, which the unprivileged discovery path in `getNetworkTopology`
 * deliberately doesn't have. The one place that *does* know the true new
 * state is whoever just successfully ran the privileged action - so
 * `network-control-service` calls this immediately after, rather than
 * `getNetworkTopology` ever being able to observe it independently.
 */
export function applyOptimisticEdgeState(
  topology: NetworkTopology,
  verb: NetworkActionVerb,
  targetId: string,
  state: "up" | "down"
): NetworkTopology {
  const edges = topology.edges.map((edge) =>
    edge.verb === verb && edge.actionTargetId === targetId ? { ...edge, state } : edge
  );

  const affectedEdge = edges.find((edge) => edge.verb === verb && edge.actionTargetId === targetId);
  if (!affectedEdge) {
    return { ...topology, edges };
  }

  const nodes = topology.nodes.map((node) =>
    node.id === affectedEdge.to && node.kind === "uplink" ? { ...node, status: state } : node
  );

  return { ...topology, nodes, edges };
}
