import { Background, BackgroundVariant, Controls, ReactFlow, type ReactFlowInstance } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useRef, useState } from "react";
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
  fitNonce: number;
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
  fitNonce,
  onSelectNode,
  onClearSelection
}: GraphViewProps) {
  const fallback = buildGraph(project);
  const [nodes, setNodes] = useState<Node[]>(fallback.nodes);
  const [edges, setEdges] = useState<Edge[]>(fallback.edges);
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
    const initial = buildGraph(project);
    setNodes(initial.nodes);
    setEdges(initial.edges);
    scheduleFitView();

    void layoutGraph(project, layoutDirection)
      .then((graph) => {
        setNodes(graph.nodes);
        setEdges(graph.edges);
        scheduleFitView();
      })
      .catch(() => {
        setNodes(initial.nodes);
        setEdges(initial.edges);
        scheduleFitView();
      });
  }, [project, layoutDirection, scheduleFitView]);

  useEffect(() => {
    scheduleFitView();
  }, [fitNonce, scheduleFitView]);

  useEffect(() => {
    const term = filterQuery.trim().toLowerCase();
    const related = relatedNodes(project, selectedNodeId);

    setNodes((current) =>
      current.map((node) => {
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
      })
    );

    setEdges((current) =>
      current.map((edge) => ({
        ...edge,
        style: {
          ...(edge.style ?? {}),
          opacity: !related || (related.has(edge.source) && related.has(edge.target)) ? 1 : 0.25,
          strokeWidth: edge.data?.kind === "dependency" ? 2.2 : edge.data?.kind === "mount" ? 1.9 : 1.5
        }
      }))
    );
  }, [filterQuery, project, selectedNodeId]);

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
        <Controls showInteractive={false} />
        <Background variant={BackgroundVariant.Dots} color="var(--border-subtle)" gap={20} size={1} />
      </ReactFlow>
    </div>
  );
}
