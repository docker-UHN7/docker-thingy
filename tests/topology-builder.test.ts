import { describe, expect, it } from "vitest";
import type { ContainerInspectSchema } from "../src/shared/contracts";
import type * as z from "zod";
import { buildTopology, type HostBridge } from "../src/main/topology-service";
import type { DockerNetworkSummary } from "../src/main/docker-service";
import type { VmDomain, VmNetwork } from "../src/main/vm-service";

type Inspected = z.infer<typeof ContainerInspectSchema>;

function container(overrides: Partial<Inspected> & { Id: string }): Inspected {
  return {
    Name: "/demo",
    Config: { Image: "demo:latest" },
    State: { Status: "running", Running: true },
    NetworkSettings: { Networks: {} },
    ...overrides
  };
}

describe("buildTopology", () => {
  it("links a running container to its Docker bridge network and marks the uplink up by default", () => {
    const containers: Inspected[] = [
      container({
        Id: "c1",
        NetworkSettings: { Networks: { bridge: {} } }
      })
    ];
    const dockerNetworks: DockerNetworkSummary[] = [{ id: "abc123", name: "bridge", driver: "bridge" }];
    const hostBridges: HostBridge[] = [{ name: "docker0", up: true }];

    const topology = buildTopology(containers, dockerNetworks, hostBridges, [], [], true);

    const containerNode = topology.nodes.find((node) => node.kind === "container");
    const bridgeNode = topology.nodes.find((node) => node.kind === "bridge");
    const uplinkNode = topology.nodes.find((node) => node.kind === "uplink");

    expect(containerNode).toMatchObject({ id: "container:c1", status: "up", detail: "demo:latest" });
    expect(bridgeNode).toMatchObject({ id: "bridge:docker0", status: "up" });
    expect(uplinkNode).toMatchObject({ status: "up" });
    expect(topology.edges).toContainEqual(
      expect.objectContaining({ from: "container:c1", to: "bridge:docker0", kind: "attachment" })
    );
    expect(topology.warning).toBeUndefined();
  });

  it("composes a container-link actionTargetId as containerId|mac so a multi-homed container's edges each target the right interface", () => {
    const containers: Inspected[] = [
      container({
        Id: "c1",
        NetworkSettings: {
          Networks: {
            bridge: { MacAddress: "02:42:ac:11:00:02" },
            custom: { MacAddress: "02:42:ac:12:00:03" }
          }
        }
      })
    ];
    const dockerNetworks: DockerNetworkSummary[] = [
      { id: "abc123", name: "bridge", driver: "bridge" },
      { id: "def456", name: "custom", driver: "bridge" }
    ];

    const topology = buildTopology(containers, dockerNetworks, [], [], [], true);
    const attachmentEdges = topology.edges.filter((edge) => edge.kind === "attachment");

    expect(attachmentEdges).toHaveLength(2);
    expect(attachmentEdges.map((edge) => edge.actionTargetId).sort()).toEqual([
      "c1|02:42:ac:11:00:02",
      "c1|02:42:ac:12:00:03"
    ]);
  });

  it("falls back to a bare container id when a network attachment has no recorded MAC", () => {
    const containers: Inspected[] = [container({ Id: "c1", NetworkSettings: { Networks: { bridge: {} } } })];
    const dockerNetworks: DockerNetworkSummary[] = [{ id: "abc123", name: "bridge", driver: "bridge" }];

    const topology = buildTopology(containers, dockerNetworks, [], [], [], true);

    expect(topology.edges.find((edge) => edge.kind === "attachment")?.actionTargetId).toBe("c1");
  });

  it("resolves the default bridge network to docker0 and a user-defined one to br-<id[:12]>", () => {
    const containers: Inspected[] = [
      container({ Id: "c1", NetworkSettings: { Networks: { bridge: {} } } }),
      container({ Id: "c2", NetworkSettings: { Networks: { custom: {} } } })
    ];
    const dockerNetworks: DockerNetworkSummary[] = [
      { id: "8d20c9fecf93a6dc25a64c13094099a9e5ce492234387129e23f6454644adc6", name: "bridge", driver: "bridge" },
      { id: "34b7257c8afaf08042048d2d7bfe9b76950baebd2ea8b8cd865c6aa882ececc", name: "custom", driver: "bridge" }
    ];

    const topology = buildTopology(containers, dockerNetworks, [], [], [], false);

    expect(topology.edges).toContainEqual(expect.objectContaining({ from: "container:c1", to: "bridge:docker0" }));
    expect(topology.edges).toContainEqual(
      expect.objectContaining({ from: "container:c2", to: "bridge:br-34b7257c8afa" })
    );
  });

  it("skips container networks that don't resolve to a known bridge (e.g. host/none driver)", () => {
    const containers: Inspected[] = [container({ Id: "c1", NetworkSettings: { Networks: { host: {} } } })];
    const dockerNetworks: DockerNetworkSummary[] = [{ id: "x", name: "host", driver: "host" }];

    const topology = buildTopology(containers, dockerNetworks, [], [], [], false);

    expect(topology.edges).toHaveLength(0);
  });

  it("links a VM interface to its libvirt network's bridge and reflects the network's forward mode on the uplink", () => {
    const vmDomains: VmDomain[] = [
      {
        name: "splunk-lab",
        uuid: "e218c8f4-7601-46a4-a963-85aee31e62cd",
        running: false,
        interfaces: [{ mac: "52:54:00:fc:c6:27", sourceNetwork: "default", linkState: "up" }]
      }
    ];
    const vmNetworks: VmNetwork[] = [{ name: "default", bridge: "virbr0", active: true, forwardMode: "nat" }];

    const topology = buildTopology([], [], [], vmDomains, vmNetworks, true);

    const vmNode = topology.nodes.find((node) => node.kind === "vm");
    expect(vmNode).toMatchObject({ id: "vm:splunk-lab", status: "down", detail: "shut off" });
    expect(topology.edges).toContainEqual(
      expect.objectContaining({ from: "vm:splunk-lab", to: "bridge:virbr0", kind: "attachment" })
    );
    const uplinkEdge = topology.edges.find((edge) => edge.kind === "uplink");
    expect(uplinkEdge?.state).toBe("up");
  });

  it("treats a libvirt network with no <forward> mode as an already-down uplink", () => {
    const vmNetworks: VmNetwork[] = [{ name: "isolated", bridge: "virbr1", active: true, forwardMode: undefined }];

    const topology = buildTopology([], [], [], [], vmNetworks, true);

    const uplinkEdge = topology.edges.find((edge) => edge.kind === "uplink");
    expect(uplinkEdge?.state).toBe("down");
  });

  it("uses a VM interface's direct source bridge when it isn't attached via a libvirt network", () => {
    const vmDomains: VmDomain[] = [
      {
        name: "bridged-vm",
        uuid: "uuid-2",
        running: true,
        interfaces: [{ mac: "aa:bb:cc:dd:ee:ff", sourceBridge: "br-lan", linkState: "up" }]
      }
    ];

    const topology = buildTopology([], [], [], vmDomains, [], true);

    expect(topology.edges).toContainEqual(
      expect.objectContaining({ from: "vm:bridged-vm", to: "bridge:br-lan" })
    );
  });

  it("surfaces a warning when libvirt isn't available, without treating it as an error", () => {
    const topology = buildTopology([], [], [], [], [], false);
    expect(topology.warning).toMatch(/libvirt/i);
    expect(topology.nodes).toHaveLength(0);
  });
});

describe("buildTopology - control state folding", () => {
  it("forces a container-link edge down when the state file records an override, even though discovery always assumes up", () => {
    const containers: Inspected[] = [
      container({ Id: "c1", NetworkSettings: { Networks: { bridge: { MacAddress: "02:42:ac:11:00:02" } } } })
    ];
    const dockerNetworks: DockerNetworkSummary[] = [{ id: "abc123", name: "bridge", driver: "bridge" }];

    const topology = buildTopology(containers, dockerNetworks, [], [], [], true, {
      containerLinks: { "c1|02:42:ac:11:00:02": "down" },
      bridgeForwards: {},
      bridgeLinks: {}
    });

    expect(topology.edges.find((edge) => edge.kind === "attachment")?.state).toBe("down");
  });

  it("forces a bridge's uplink down when the state file records a deny, overriding the discovered default", () => {
    const dockerNetworks: DockerNetworkSummary[] = [{ id: "abc123", name: "bridge", driver: "bridge" }];

    const topology = buildTopology([], dockerNetworks, [], [], [], true, {
      containerLinks: {},
      bridgeForwards: { docker0: "deny" },
      bridgeLinks: {}
    });

    const uplinkEdge = topology.edges.find((edge) => edge.kind === "uplink");
    expect(uplinkEdge?.state).toBe("down");
    expect(topology.nodes.find((node) => node.kind === "uplink")?.status).toBe("down");
  });

  it("synthesizes an interconnect edge between two existing bridges from the state file - their only discovery path", () => {
    const dockerNetworks: DockerNetworkSummary[] = [
      { id: "abc123", name: "bridge", driver: "bridge" },
      { id: "def456", name: "custom", driver: "bridge" }
    ];

    const topology = buildTopology([], dockerNetworks, [], [], [], true, {
      containerLinks: {},
      bridgeForwards: {},
      bridgeLinks: { "br-def456|docker0": "connected" }
    });

    const interconnectEdge = topology.edges.find((edge) => edge.kind === "interconnect");
    expect(interconnectEdge).toMatchObject({
      from: "bridge:br-def456",
      to: "bridge:docker0",
      state: "up",
      verb: "bridge-link",
      actionTargetId: "br-def456|docker0"
    });
  });

  it("skips a stale bridgeLinks entry referencing a bridge that no longer exists", () => {
    const topology = buildTopology([], [], [], [], [], true, {
      containerLinks: {},
      bridgeForwards: {},
      bridgeLinks: { "docker0|virbr0": "connected" }
    });

    expect(topology.edges.find((edge) => edge.kind === "interconnect")).toBeUndefined();
  });
});
