import {
  Controls,
  ReactFlow,
  applyNodeChanges,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type ReactFlowInstance
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ProjectSummary } from "../../shared/contracts";
import { buildGraph, layoutGraph, resolveMeasuredLayout, type GraphEdgeData, type GraphNodeData } from "./graph-builder";
import { ExternalNode, ServiceNode, VolumeNode } from "./DockerNodes";
import { StraightLabeledEdge } from "./StraightLabeledEdge";

const nodeTypes = {
  serviceNode: ServiceNode,
  volumeNode: VolumeNode,
  externalNode: ExternalNode
};

const edgeTypes = {
  smartStraight: StraightLabeledEdge
};

// Every graph edge maps onto a single, unambiguous compose-file edit (remove
// one depends_on entry / one volume mount).
export type DisconnectableEdge =
  | { kind: "dependency"; fromService: string; toService: string }
  | { kind: "mount"; serviceName: string; volumeName: string };

type GraphViewProps = {
  project: ProjectSummary;
  filterQuery: string;
  selectedNodeId: string | undefined;
  children?: ReactNode;
  onSelectNode(nodeId: string): void;
  onClearSelection(): void;
  onDisconnectEdge?: ((edge: DisconnectableEdge) => void) | undefined;
};

type FlowNode = Node<GraphNodeData>;
type FlowEdge = Edge<GraphEdgeData>;

function relatedNodes(project: ProjectSummary, selectedNodeId: string | undefined): Set<string> | undefined {
  if (!selectedNodeId) {
    return undefined;
  }

  const selected = project.services.find((service) => service.id === selectedNodeId);
  if (!selected) {
    return undefined;
  }

  const output = new Set<string>([selectedNodeId]);
  for (const volumeName of selected.categories.volumes) {
    output.add(`volume:${volumeName}`);
  }

  for (const service of project.services) {
    if (service.id === selectedNodeId) {
      continue;
    }

    const sharesVolume = service.categories.volumes.some((volumeName) => selected.categories.volumes.includes(volumeName));

    if (service.dependencies.includes(selected.name) || selected.dependencies.includes(service.name) || sharesVolume) {
      output.add(service.id);
    }
  }

  return output;
}

export function GraphView({
  project,
  filterQuery,
  selectedNodeId,
  children,
  onSelectNode,
  onClearSelection,
  onDisconnectEdge
}: GraphViewProps) {
  const initialGraph = useMemo(() => layoutGraph(project), [project]);
  const [rawNodes, setRawNodes] = useState<FlowNode[]>(() => initialGraph.nodes);
  const [rawEdges, setRawEdges] = useState<FlowEdge[]>(() => initialGraph.edges);
  const [layoutRevision, setLayoutRevision] = useState(0);
  const flowRef = useRef<ReactFlowInstance<FlowNode, FlowEdge> | null>(null);
  const measureFrameRef = useRef<number | null>(null);

  const structureKey = useMemo(
    () =>
      JSON.stringify({
        services: project.services.map((service) => ({
          id: service.id,
          name: service.name,
          image: service.image,
          ports: service.portMappings.map((port) => [port.id, port.label, port.state, port.hostPort, port.hostIp]),
          dependencies: service.dependencies,
          networks: service.categories.networks,
          volumes: service.categories.volumes,
          sourceHints: service.sourceHints
        })),
        externalNodes: project.externalNodes,
        relationshipEdges: project.relationshipEdges
      }),
    [project]
  );

  useEffect(() => {
    const nextGraph = buildGraph(project);
    setRawNodes((current) =>
      nextGraph.nodes.map((node) => {
        const existing = current.find((entry) => entry.id === node.id);
        return existing ? { ...node, position: existing.position } : node;
      })
    );
    setRawEdges(nextGraph.edges);
  }, [project]);

  useEffect(() => {
    const graph = layoutGraph(project);
    setRawNodes(graph.nodes);
    setRawEdges(graph.edges);
    setLayoutRevision((current) => current + 1);
  }, [structureKey]);

  useEffect(() => {
    if (!flowRef.current || rawNodes.length === 0) {
      return;
    }

    if (measureFrameRef.current !== null) {
      cancelAnimationFrame(measureFrameRef.current);
    }

    measureFrameRef.current = requestAnimationFrame(() => {
      measureFrameRef.current = requestAnimationFrame(() => {
        const measuredNodes = flowRef.current?.getNodes().map((node) => {
          const width = node.measured?.width ?? node.width;
          const height = node.measured?.height ?? node.height;
          if (!width || !height) {
            return undefined;
          }

          return {
            id: node.id,
            width,
            height
          };
        }).filter((node): node is { id: string; width: number; height: number } => Boolean(node));

        if (!measuredNodes || measuredNodes.length === 0) {
          return;
        }

        setRawNodes((current) => {
          const next = resolveMeasuredLayout(current, rawEdges, measuredNodes);
          const changed = next.some((node, index) => {
            const currentNode = current[index];
            return !currentNode || currentNode.id !== node.id || currentNode.position.x !== node.position.x || currentNode.position.y !== node.position.y;
          });

          return changed ? next : current;
        });
      });
    });
  }, [layoutRevision, rawEdges, rawNodes.length]);
  const related = useMemo(() => relatedNodes(project, selectedNodeId), [project, selectedNodeId]);

  const nodes = useMemo<FlowNode[]>(() => {
    const term = filterQuery.trim().toLowerCase();

    return rawNodes.map((node) => {
      const data = node.data as { name?: string; image?: string; ports?: string[]; subtitle?: string };
      const matches =
        term === "" ||
        [data.name, data.image, data.subtitle, ...(data.ports ?? [])]
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

  const edges = useMemo<FlowEdge[]>(
    () =>
      rawEdges.map((edge) => {
        const kind = (edge.data as GraphEdgeData | undefined)?.kind;
        const disconnectable = Boolean(onDisconnectEdge) && (kind === "dependency" || kind === "mount");

        return {
          ...edge,
          style: {
            ...(edge.style ?? {}),
            opacity: !related || (related.has(edge.source) && related.has(edge.target)) ? 1 : 0.25,
            strokeWidth: kind === "dependency" ? 2.2 : kind === "mount" ? 1.9 : 1.5,
            cursor: disconnectable ? "pointer" : undefined
          }
        };
      }),
    [rawEdges, related, onDisconnectEdge]
  );

  useEffect(
    () => () => {
      if (measureFrameRef.current !== null) {
        cancelAnimationFrame(measureFrameRef.current);
      }
    },
    []
  );

  const onNodesChange = useCallback((changes: NodeChange<FlowNode>[]) => {
    setRawNodes((current) => applyNodeChanges(changes, current));
  }, []);

  const onEdgesChange = useCallback((_changes: EdgeChange<FlowEdge>[]) => {
    // Graph edges are structural, not user-editable.
  }, []);

  return (
    <div className="graph-shell">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={{ type: "smartStraight" }}
        fitView={false}
        minZoom={0.2}
        maxZoom={1.6}
        proOptions={{ hideAttribution: true }}
        nodesDraggable
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onPaneClick={() => onClearSelection()}
        onNodeClick={(_event, node) => {
          if (node.type === "serviceNode") {
            onSelectNode(node.id);
          }
        }}
        onEdgeClick={(_event, edge) => {
          if (!onDisconnectEdge) {
            return;
          }

          const kind = (edge.data as GraphEdgeData | undefined)?.kind;

          if (kind === "dependency") {
            const fromService = project.services.find((service) => service.id === edge.source)?.name;
            if (!fromService) {
              return;
            }
            const toService =
              project.services.find((service) => service.id === edge.target)?.name ??
              edge.target.replace(/^external-service:/, "");
            onDisconnectEdge({ kind: "dependency", fromService, toService });
            return;
          }

          if (kind === "mount") {
            const serviceName = project.services.find((service) => service.id === edge.target)?.name;
            if (!serviceName) {
              return;
            }
            const volumeName = edge.source.replace(/^volume:/, "");
            onDisconnectEdge({ kind: "mount", serviceName, volumeName });
          }
        }}
        onInit={(instance) => {
          flowRef.current = instance;
        }}
      >
        {children}
        <Controls showInteractive={false} showFitView fitViewOptions={{ padding: 0.18, duration: 220 }} />
      </ReactFlow>
    </div>
  );
}
