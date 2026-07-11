import { Background, BackgroundVariant, Controls, ReactFlow, type ReactFlowInstance } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ArrowLeft, LoaderCircle, MoonStar, RefreshCw, SunMedium, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Edge, EdgeMouseHandler, Node } from "@xyflow/react";
import { buildTopologyGraph, layoutTopologyGraph } from "./topology-graph-builder";
import { TopologyNode, UplinkNode } from "./TopologyNodes";
import { useNetworkStore } from "./networkStore";

const nodeTypes = {
  topologyNode: TopologyNode,
  uplinkNode: UplinkNode
};

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
    (_event, edge) => {
      if (!topology || pendingEdgeId) {
        return;
      }

      const model = topology.edges.find((entry) => entry.id === edge.id);
      if (!model || !model.controllable) {
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

      if (!window.confirm(`${action} ${subject}?`)) {
        return;
      }

      void runAction(model.id, model.verb, model.actionTargetId, nextState);
    },
    [topology, pendingEdgeId, runAction]
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

      <div className="workspace-frame">
        <section className="graph-stage">
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
      </div>
    </main>
  );
}
