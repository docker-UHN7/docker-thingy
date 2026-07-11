import { Background, BackgroundVariant, Controls, ReactFlow, type ReactFlowInstance } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ArrowLeft, LoaderCircle, MoonStar, RefreshCw, SunMedium, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Connection, Edge, EdgeMouseHandler, Node, OnReconnect } from "@xyflow/react";
import type { NetworkActionVerb } from "../../shared/network-contracts";
import { buildTopologyGraph, layoutTopologyGraph } from "./topology-graph-builder";
import { TopologyNode, UplinkNode } from "./TopologyNodes";
import { useNetworkStore } from "./networkStore";
import { useConfirmDialog } from "./ConfirmDialog";

const BRIDGE_NODE_PREFIX = "bridge:";
const CONTAINER_NODE_PREFIX = "container:";
const VM_NODE_PREFIX = "vm:";

// Every edge buildTopology() ever produces uses one of these four - the
// remaining verbs (reattach/connect) are action-only, never a discovered
// edge's own verb. Narrowing on this set (rather than excluding the other
// verbs one at a time) is what keeps handleEdgeClick's request object
// assignable to NetworkActionRequest's toggle-shaped union member.
const TOGGLE_VERBS = new Set<NetworkActionVerb>(["container-link", "vm-link", "bridge-forward", "bridge-link"]);
function isToggleVerb(
  verb: NetworkActionVerb
): verb is "container-link" | "vm-link" | "bridge-forward" | "bridge-link" {
  return TOGGLE_VERBS.has(verb);
}

const nodeTypes = {
  topologyNode: TopologyNode,
  uplinkNode: UplinkNode
};

type DeviceBridgeConnection = {
  deviceNodeId: string;
  deviceKind: "container" | "vm";
  bridgeNodeId: string;
};

// A fresh drag between a container/VM node and a bridge node, in either
// direction (both node types render a source *and* a target handle - see
// TopologyNodes.tsx). Returns null for anything else (bridge<->bridge is
// handled separately; device<->device isn't a connection this app models).
function resolveDeviceBridgeConnection(connection: Connection): DeviceBridgeConnection | null {
  const { source, target } = connection;
  if (typeof source !== "string" || typeof target !== "string" || source === target) {
    return null;
  }

  let bridgeNodeId: string;
  let deviceNodeId: string;
  if (source.startsWith(BRIDGE_NODE_PREFIX)) {
    bridgeNodeId = source;
    deviceNodeId = target;
  } else if (target.startsWith(BRIDGE_NODE_PREFIX)) {
    bridgeNodeId = target;
    deviceNodeId = source;
  } else {
    return null;
  }

  if (deviceNodeId.startsWith(CONTAINER_NODE_PREFIX)) {
    return { deviceNodeId, deviceKind: "container", bridgeNodeId };
  }
  if (deviceNodeId.startsWith(VM_NODE_PREFIX)) {
    return { deviceNodeId, deviceKind: "vm", bridgeNodeId };
  }
  return null;
}

const POLL_MS = 5000;

type NetworkTopologyViewProps = {
  theme: "dark" | "light";
  onBack(): void;
  onToggleTheme(): void;
};

export function NetworkTopologyView({ theme, onBack, onToggleTheme }: NetworkTopologyViewProps) {
  const topology = useNetworkStore((state) => state.topology);
  const loading = useNetworkStore((state) => state.loading);
  const error = useNetworkStore((state) => state.error);
  const pendingEdgeId = useNetworkStore((state) => state.pendingEdgeId);
  const refresh = useNetworkStore((state) => state.refresh);
  const runAction = useNetworkStore((state) => state.runAction);
  const { confirm, dialog } = useConfirmDialog();

  const [rawNodes, setRawNodes] = useState<Node[]>([]);
  const [rawEdges, setRawEdges] = useState<Edge[]>([]);
  const flowRef = useRef<ReactFlowInstance | null>(null);
  const fitFrameRef = useRef<number | null>(null);

  const scheduleFitView = useCallback(() => {
    if (!flowRef.current) {
      return;
    }

    if (fitFrameRef.current !== null) {
      cancelAnimationFrame(fitFrameRef.current);
    }

    fitFrameRef.current = requestAnimationFrame(() => {
      fitFrameRef.current = requestAnimationFrame(() => {
        void flowRef.current?.fitView({ padding: 0.18, duration: 280 });
      });
    });
  }, []);

  useEffect(() => {
    void refresh();
    const intervalId = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(intervalId);
  }, [refresh]);

  useEffect(() => {
    if (!topology) {
      return;
    }

    let cancelled = false;
    const initial = buildTopologyGraph(topology);
    setRawNodes(initial.nodes);
    setRawEdges(initial.edges);
    scheduleFitView();

    void layoutTopologyGraph(topology)
      .then((graph) => {
        if (cancelled) return;
        setRawNodes(graph.nodes);
        setRawEdges(graph.edges);
        scheduleFitView();
      })
      .catch(() => {
        if (cancelled) return;
        setRawNodes(initial.nodes);
        setRawEdges(initial.edges);
        scheduleFitView();
      });

    return () => {
      cancelled = true;
    };
  }, [topology, scheduleFitView]);

  useEffect(
    () => () => {
      if (fitFrameRef.current !== null) {
        cancelAnimationFrame(fitFrameRef.current);
      }
    },
    []
  );

  const handleEdgeClick = useCallback<EdgeMouseHandler>(
    async (_event, edge) => {
      if (!topology || pendingEdgeId) {
        return;
      }

      const model = topology.edges.find((entry) => entry.id === edge.id);
      if (!model || !model.controllable) {
        return;
      }
      // Reattach/connect verbs are never populated on a discovered edge
      // (only click-to-toggle verbs are) - this just satisfies the type,
      // it's not expected to trigger in practice.
      if (!isToggleVerb(model.verb)) {
        return;
      }

      const nextState: "up" | "down" = model.state === "up" ? "down" : "up";
      const fromNode = topology.nodes.find((node) => node.id === model.from);
      const toNode = topology.nodes.find((node) => node.id === model.to);
      const action = nextState === "down" ? "Disconnect" : "Reconnect";
      const subject =
        model.kind === "uplink"
          ? `${fromNode?.name ?? model.from}'s route to the internet/LAN`
          : `${fromNode?.name ?? model.from} from ${toNode?.name ?? model.to}`;

      if (!(await confirm(`${action} ${subject}?`, nextState === "down" ? "danger" : "default"))) {
        return;
      }

      void runAction(model.id, { verb: model.verb, targetId: model.actionTargetId, state: nextState });
    },
    [topology, pendingEdgeId, runAction, confirm]
  );

  // Dragging an attachment edge's bridge end onto a *different* bridge moves
  // that container/VM there instead of just severing it - the natural
  // gesture for "put this on a different network" (e.g. a fake-DNS network
  // for a malware-analysis VM), distinct from the up/down toggle above.
  const handleReconnect = useCallback<OnReconnect>(
    async (oldEdge, connection: Connection) => {
      if (!topology || pendingEdgeId) {
        return;
      }

      const model = topology.edges.find((entry) => entry.id === oldEdge.id);
      if (!model || model.kind !== "attachment") {
        return;
      }
      if (model.verb !== "container-link" && model.verb !== "vm-link") {
        return;
      }
      // Only the bridge end may move - if the device end changed instead,
      // this isn't a reattach we understand.
      if (connection.source !== model.from) {
        return;
      }

      const newBridgeId = connection.target;
      if (!newBridgeId.startsWith(BRIDGE_NODE_PREFIX) || newBridgeId === model.to) {
        return;
      }

      const toBridge = newBridgeId.slice(BRIDGE_NODE_PREFIX.length);
      const deviceNode = topology.nodes.find((node) => node.id === model.from);
      const newBridgeNode = topology.nodes.find((node) => node.id === newBridgeId);

      if (!(await confirm(`Move ${deviceNode?.name ?? model.from} to ${newBridgeNode?.name ?? toBridge}?`))) {
        return;
      }

      const verb = model.verb === "container-link" ? "container-reattach" : "vm-reattach";
      void runAction(model.id, { verb, targetId: model.actionTargetId, toBridge });
    },
    [topology, pendingEdgeId, runAction, confirm]
  );

  const isValidBridgeConnection = useCallback(
    (connection: Connection | Edge) =>
      typeof connection.source === "string" &&
      typeof connection.target === "string" &&
      connection.source.startsWith(BRIDGE_NODE_PREFIX) &&
      connection.target.startsWith(BRIDGE_NODE_PREFIX) &&
      connection.source !== connection.target,
    []
  );

  // Dragging from scratch between two *bridge* nodes creates a new
  // interconnect - e.g. letting an otherwise-isolated network specifically
  // reach a fake-DNS network without opening it back up to the real
  // internet. Dragging from scratch between a container/VM node and a
  // *different* bridge attaches it there in addition to whatever it's
  // already on (no disconnect step - that's what reattach, via dragging an
  // *existing* edge, is for).
  const handleConnect = useCallback(
    async (connection: Connection) => {
      if (!topology || pendingEdgeId) {
        return;
      }

      if (isValidBridgeConnection(connection)) {
        const { source, target } = connection;
        const alreadyLinked = topology.edges.some(
          (edge) =>
            edge.kind === "interconnect" &&
            ((edge.from === source && edge.to === target) || (edge.from === target && edge.to === source))
        );
        if (alreadyLinked) {
          return;
        }

        const bridgeA = source.slice(BRIDGE_NODE_PREFIX.length);
        const bridgeB = target.slice(BRIDGE_NODE_PREFIX.length);
        const bridgeANode = topology.nodes.find((node) => node.id === source);
        const bridgeBNode = topology.nodes.find((node) => node.id === target);

        if (
          !(await confirm(
            `Connect ${bridgeANode?.name ?? bridgeA} to ${bridgeBNode?.name ?? bridgeB}? Traffic will be allowed to flow between them.`
          ))
        ) {
          return;
        }

        void runAction(`link:${bridgeA}:${bridgeB}`, {
          verb: "bridge-link",
          targetId: `${bridgeA}|${bridgeB}`,
          state: "up"
        });
        return;
      }

      const deviceConnection = resolveDeviceBridgeConnection(connection);
      if (!deviceConnection) {
        return;
      }

      const { deviceNodeId, deviceKind, bridgeNodeId } = deviceConnection;
      const alreadyAttached = topology.edges.some(
        (edge) => edge.kind === "attachment" && edge.from === deviceNodeId && edge.to === bridgeNodeId
      );
      if (alreadyAttached) {
        return;
      }

      const devicePrefixLength = deviceKind === "container" ? CONTAINER_NODE_PREFIX.length : VM_NODE_PREFIX.length;
      const deviceId = deviceNodeId.slice(devicePrefixLength);
      const toBridge = bridgeNodeId.slice(BRIDGE_NODE_PREFIX.length);
      const deviceNode = topology.nodes.find((node) => node.id === deviceNodeId);
      const bridgeNode = topology.nodes.find((node) => node.id === bridgeNodeId);

      if (!(await confirm(`Connect ${deviceNode?.name ?? deviceId} to ${bridgeNode?.name ?? toBridge}?`))) {
        return;
      }

      void runAction(`connect:${deviceNodeId}:${bridgeNodeId}`, {
        verb: deviceKind === "container" ? "container-connect" : "vm-connect",
        targetId: deviceId,
        toBridge
      });
    },
    [topology, pendingEdgeId, runAction, isValidBridgeConnection, confirm]
  );

  const containerCount = topology?.nodes.filter((node) => node.kind === "container").length ?? 0;
  const vmCount = topology?.nodes.filter((node) => node.kind === "vm").length ?? 0;
  const bridgeCount = topology?.nodes.filter((node) => node.kind === "bridge").length ?? 0;

  return (
    <main className="workspace-screen">
      <header className="topbar topbar--workspace">
        <div className="toolbar-left">
          <button className="icon-button" onClick={onBack} aria-label="Back to projects">
            <ArrowLeft size={16} />
          </button>
          <div className="toolbar-project">
            <h2 className="toolbar-project__title">Network Topology</h2>
            <span className="metadata-note">
              {containerCount} containers, {vmCount} VMs, {bridgeCount} bridges - click an edge to disconnect/reconnect it
            </span>
          </div>
        </div>

        <div className="toolbar-tools">
          {pendingEdgeId ? (
            <span className="toolbar-note">
              <LoaderCircle size={14} className="busy spin" /> Applying...
            </span>
          ) : null}
          <button className="icon-button" onClick={() => void refresh()} aria-label="Refresh topology">
            <RefreshCw size={16} className={loading ? "busy spin" : undefined} />
          </button>
          <button className="icon-button" onClick={onToggleTheme} aria-label="Toggle theme">
            {theme === "dark" ? <SunMedium size={16} /> : <MoonStar size={16} />}
          </button>
        </div>
      </header>

      {error ? (
        <div className="error-banner error-banner--inline">
          <TriangleAlert size={16} />
          <span>{error}</span>
        </div>
      ) : null}

      {topology?.warning ? (
        <div className="daemon-banner">
          <div className="daemon-banner__copy">
            <span className="status-dot status-dot--warning" />
            <span>{topology.warning}</span>
          </div>
        </div>
      ) : null}

      {topology && !topology.controlAgentAvailable ? (
        <div className="daemon-banner">
          <div className="daemon-banner__copy">
            <span className="status-dot status-dot--warning" />
            <span>
              No polkit authentication agent detected - disconnect/reconnect actions on containers and bridges will
              fail until one is running (e.g. hyprpolkitagent on Hyprland, or polkit-gnome/polkit-kde/xfce-polkit
              elsewhere).
            </span>
          </div>
        </div>
      ) : null}

      <section className="workspace-canvas">
        {loading && !topology ? (
          <div className="empty-dropzone">
            <LoaderCircle size={28} className="busy spin" />
            <p>Discovering containers, VMs, and bridges...</p>
          </div>
        ) : (
          <div className="graph-shell">
            <ReactFlow
              nodes={rawNodes}
              edges={rawEdges}
              nodeTypes={nodeTypes}
              fitView={false}
              proOptions={{ hideAttribution: true }}
              nodesDraggable={false}
              onEdgeClick={handleEdgeClick}
              onReconnect={handleReconnect}
              onConnect={handleConnect}
              onInit={(instance) => {
                flowRef.current = instance;
                scheduleFitView();
              }}
            >
              <Controls showInteractive={false} />
              <Background variant={BackgroundVariant.Dots} color="var(--border-subtle)" gap={20} size={1} />
            </ReactFlow>
          </div>
        )}
      </section>

      {dialog}
    </main>
  );
}
