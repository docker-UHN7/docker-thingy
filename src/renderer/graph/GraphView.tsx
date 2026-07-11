import { Background, BackgroundVariant, Controls, ReactFlow, type ReactFlowInstance } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Edge, Node } from "@xyflow/react";
import type { ProjectSummary } from "../../shared/contracts";
import { buildGraph, layoutGraph } from "./graph-builder";
import { ExternalNode, NetworkRegionNode, ServiceNode, VolumeNode } from "./DockerNodes";

const nodeTypes = {
  serviceNode: ServiceNode,
  networkRegion: NetworkRegionNode,
  volumeNode: VolumeNode,
  externalNode: ExternalNode
};

type GraphViewProps = {
  project: ProjectSummary;
  filterQuery: string;
  selectedNodeId: string | undefined;
  layoutDirection: "RIGHT" | "DOWN";
  children?: ReactNode;
  onSelectNode(nodeId: string): void;
  onClearSelection(): void;
};

function relatedNodes(project: ProjectSummary, selectedNodeId: string | undefined): Set<string> | undefined {
  if (!selectedNodeId) {
    return undefined;
  }

  const selected = project.services.find((service) => service.id === selectedNodeId);
  if (!selected) {
    return undefined;
  }

  const output = new Set<string>([selectedNodeId]);
  for (const service of project.services) {
    if (service.id === selectedNodeId) {
      continue;
    }

    if (service.dependencies.includes(selected.name) || selected.dependencies.includes(service.name)) {
      output.add(service.id);
    }
  }

  return output;
}

export function GraphView({
  project,
  filterQuery,
  selectedNodeId,
  layoutDirection,
  children,
  onSelectNode,
  onClearSelection
}: GraphViewProps) {
  const [rawNodes, setRawNodes] = useState<Node[]>(() => buildGraph(project).nodes);
  const [rawEdges, setRawEdges] = useState<Edge[]>(() => buildGraph(project).edges);
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

  // Layout is (re)computed asynchronously by elkjs, which resolves well after this
  // effect returns. We only ever write the *structural* nodes/edges here (position,
  // type, data) - selection/filter highlighting is layered on top via the memos
  // below so that a layout recompute (e.g. triggered by a runtime poll while a
  // node is selected) can never clobber the current selection/dim state.
  useEffect(() => {
    let cancelled = false;

    void layoutGraph(project, layoutDirection)
      .then((graph) => {
        if (cancelled) {
          return;
        }
        setRawNodes(graph.nodes);
        setRawEdges(graph.edges);
        scheduleFitView();
      })
      .catch((err) => {
        if (cancelled) {
          return;
        }
        console.error("Graph layout failed", err);
      });

    return () => {
      cancelled = true;
    };
  }, [project, layoutDirection, scheduleFitView]);
  const related = useMemo(() => relatedNodes(project, selectedNodeId), [project, selectedNodeId]);

  const nodes = useMemo<Node[]>(() => {
    const term = filterQuery.trim().toLowerCase();

    return rawNodes.map((node) => {
      if (node.type === "networkRegion") {
        return {
          ...node,
          style: {
            ...node.style,
            opacity: selectedNodeId ? 0.3 : 1
          }
        };
      }

      const data = node.data as { name?: string; image?: string; ports?: string[] };
      const matches =
        term === "" ||
        [data.name, data.image, ...(data.ports ?? [])]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(term);
      const connected = !related || related.has(node.id);

      return {
        ...node,
        selected: node.id === selectedNodeId,
        style: {
          ...node.style,
          opacity: matches ? (connected ? 1 : 0.22) : 0.18
        }
      };
    });
  }, [rawNodes, filterQuery, selectedNodeId, related]);

  const edges = useMemo<Edge[]>(
    () =>
      rawEdges.map((edge) => ({
        ...edge,
        style: {
          ...(edge.style ?? {}),
          opacity: !related || (related.has(edge.source) && related.has(edge.target)) ? 1 : 0.25,
          strokeWidth: edge.data?.kind === "dependency" ? 2.2 : edge.data?.kind === "mount" ? 1.9 : 1.5
        }
      })),
    [rawEdges, related]
  );

  useEffect(
    () => () => {
      if (fitFrameRef.current !== null) {
        cancelAnimationFrame(fitFrameRef.current);
      }
    },
    []
  );

  return (
    <div className="graph-shell">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView={false}
        minZoom={0.2}
        maxZoom={1.6}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        onPaneClick={() => onClearSelection()}
        onNodeClick={(_event, node) => {
          if (node.type === "serviceNode") {
            onSelectNode(node.id);
          }
        }}
        onInit={(instance) => {
          flowRef.current = instance;
          scheduleFitView();
        }}
      >
        {children}
        <Controls showInteractive={false} showFitView fitViewOptions={{ padding: 0.18, duration: 220 }} />
        <Background variant={BackgroundVariant.Dots} color="var(--border-subtle)" gap={20} size={1} />
      </ReactFlow>
    </div>
  );
}
