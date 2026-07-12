import {
  Controls,
  ReactFlow,
  applyNodeChanges,
  type FitViewOptions,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type OnNodeDrag,
  type ReactFlowInstance
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ProjectSummary } from "../../shared/contracts";
import { layoutGraph, resolveMeasuredLayout, type GraphEdgeData, type GraphNodeData } from "./graph-builder";
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
  onSelectHealthEdge?(payload: { providerName: string; consumerName: string; providerId?: string | undefined }): void;
  onClearSelection(): void;
  onDisconnectEdge?: ((edge: DisconnectableEdge) => void) | undefined;
};

type FlowNode = Node<GraphNodeData>;
type FlowEdge = Edge<GraphEdgeData>;
const INITIAL_FIT_OPTIONS: FitViewOptions<FlowNode> = { padding: 0.18, duration: 220 };

type StoredPosition = { x: number; y: number };

function mergeNodesPreservingPositions(
  nextNodes: FlowNode[],
  currentNodes: FlowNode[],
  storedPositions: Map<string, StoredPosition>
): FlowNode[] {
  return nextNodes.map((node) => {
    const stored = storedPositions.get(node.id);
    if (stored) {
      return { ...node, position: stored };
    }

    const existing = currentNodes.find((entry) => entry.id === node.id);
    return existing ? { ...node, position: existing.position } : node;
  });
}

function refreshNodesWithoutRelayout(
  nextNodes: FlowNode[],
  currentNodes: FlowNode[],
  storedPositions: Map<string, StoredPosition>
): FlowNode[] {
  const currentById = new Map(currentNodes.map((node) => [node.id, node]));

  return nextNodes.map((node) => {
    const current = currentById.get(node.id);
    const stored = storedPositions.get(node.id);
    const position = stored ?? current?.position ?? node.position;

    if (!current) {
      return { ...node, position };
    }

    return {
      ...current,
      ...node,
      position
    };
  });
}

function topologySignature(nodes: FlowNode[], edges: FlowEdge[]): string {
  return JSON.stringify({
    nodes: nodes.map((node) => [node.id, node.type]),
    edges: edges.map((edge) => [edge.id, edge.source, edge.target, edge.data?.kind, edge.data?.label ?? ""])
  });
}

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
  onSelectHealthEdge,
  onClearSelection,
  onDisconnectEdge
}: GraphViewProps) {
  const initialGraph = useMemo(() => layoutGraph(project), [project]);
  const [rawNodes, setRawNodes] = useState<FlowNode[]>(() => initialGraph.nodes);
  const [rawEdges, setRawEdges] = useState<FlowEdge[]>(() => initialGraph.edges);
  const [layoutRevision, setLayoutRevision] = useState(0);
  const flowRef = useRef<ReactFlowInstance<FlowNode, FlowEdge> | null>(null);
  const initialFitFrameRef = useRef<number | null>(null);
  const measureFrameRef = useRef<number | null>(null);
  const rawNodesRef = useRef<FlowNode[]>(rawNodes);
  const rawEdgesRef = useRef<FlowEdge[]>(rawEdges);
  const storedPositionsRef = useRef<Map<string, StoredPosition>>(new Map());
  const pendingInitialFitRef = useRef(true);
  const fittedProjectIdRef = useRef<string | undefined>(undefined);
  const [flowReadyRevision, setFlowReadyRevision] = useState(0);
  const [measuredRevision, setMeasuredRevision] = useState(0);

  const structureKey = useMemo(
    () =>
      JSON.stringify({
        services: project.services.map((service) => ({
          id: service.id,
          name: service.name,
          dependencies: service.dependencies,
          networks: service.categories.networks,
          volumes: service.categories.volumes
        })),
        relationshipEdges: project.relationshipEdges
      }),
    [project]
  );

  useEffect(() => {
    rawNodesRef.current = rawNodes;
  }, [rawNodes]);

  useEffect(() => {
    rawEdgesRef.current = rawEdges;
  }, [rawEdges]);

  useEffect(() => {
    if (fittedProjectIdRef.current !== project.id) {
      pendingInitialFitRef.current = true;
      fittedProjectIdRef.current = project.id;
      storedPositionsRef.current = new Map();
      setMeasuredRevision(0);
    }
  }, [project.id]);

  useEffect(() => {
    const graph = layoutGraph(project);
    const nextTopology = topologySignature(graph.nodes, graph.edges);
    const currentTopology = topologySignature(rawNodesRef.current, rawEdgesRef.current);
    const topologyChanged = nextTopology !== currentTopology;

    setRawNodes((current) =>
      topologyChanged
        ? mergeNodesPreservingPositions(graph.nodes, current, storedPositionsRef.current)
        : refreshNodesWithoutRelayout(graph.nodes, current, storedPositionsRef.current)
    );
    setRawEdges(graph.edges);

    if (topologyChanged) {
      setLayoutRevision((current) => current + 1);
    }
  }, [project, structureKey]);

  useEffect(() => {
    if (!flowRef.current || !pendingInitialFitRef.current || rawNodes.length === 0 || measuredRevision === 0) {
      return;
    }

    if (initialFitFrameRef.current !== null) {
      cancelAnimationFrame(initialFitFrameRef.current);
    }

    initialFitFrameRef.current = requestAnimationFrame(() => {
      initialFitFrameRef.current = requestAnimationFrame(() => {
        if (!flowRef.current || !pendingInitialFitRef.current) {
          return;
        }

        pendingInitialFitRef.current = false;
        void flowRef.current.fitView(INITIAL_FIT_OPTIONS);
      });
    });
  }, [project.id, rawNodes.length, flowReadyRevision, layoutRevision, measuredRevision]);

  useEffect(() => {
    if (!flowRef.current || rawNodes.length === 0) {
      return;
    }

    const hasStoredManualPositions = storedPositionsRef.current.size > 0;
    if (hasStoredManualPositions && !pendingInitialFitRef.current) {
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

        setMeasuredRevision((current) => current + 1);

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
  }, [layoutRevision, rawEdges, rawNodes.length, flowReadyRevision]);
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
        const edgeData = edge.data as GraphEdgeData | undefined;
        const kind = edgeData?.kind;
        const disconnectable = Boolean(onDisconnectEdge) && (kind === "dependency" || kind === "mount");
        const healthSelectable =
          kind === "dependency" &&
          edgeData?.condition === "service_healthy" &&
          edgeData.providerName &&
          edgeData.consumerName &&
          Boolean(onSelectHealthEdge);

        return {
          ...edge,
          data: {
            ...edgeData,
            onActivate: healthSelectable
              ? () =>
                  onSelectHealthEdge?.({
                    providerName: edgeData.providerName!,
                    consumerName: edgeData.consumerName!,
                    providerId: project.services.find((service) => service.id === edge.source)?.id
                  })
              : undefined
          },
          style: {
            ...(edge.style ?? {}),
            opacity: !related || (related.has(edge.source) && related.has(edge.target)) ? 1 : 0.25,
            strokeWidth: kind === "dependency" ? 2.2 : kind === "mount" ? 1.9 : 1.5,
            cursor: disconnectable || healthSelectable ? "pointer" : undefined
          }
        };
      }),
    [rawEdges, related, onDisconnectEdge, onSelectHealthEdge, project.services]
  );

  useEffect(
    () => () => {
      if (initialFitFrameRef.current !== null) {
        cancelAnimationFrame(initialFitFrameRef.current);
      }
      if (measureFrameRef.current !== null) {
        cancelAnimationFrame(measureFrameRef.current);
      }
    },
    []
  );

  const onNodesChange = useCallback((changes: NodeChange<FlowNode>[]) => {
    for (const change of changes) {
      if (change.type !== "position" || !change.position) {
        continue;
      }

      storedPositionsRef.current.set(change.id, change.position);
    }

    setRawNodes((current) => applyNodeChanges(changes, current));
  }, []);

  const onEdgesChange = useCallback((_changes: EdgeChange<FlowEdge>[]) => {
    // Graph edges are structural, not user-editable.
  }, []);

  const onNodeDragStop = useCallback<OnNodeDrag<FlowNode>>((_event, node) => {
    storedPositionsRef.current.set(node.id, { ...node.position });
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
        onNodeDragStop={onNodeDragStop}
        onPaneClick={() => onClearSelection()}
        onNodeClick={(_event, node) => {
          if (node.type === "serviceNode") {
            onSelectNode(node.id);
          }
        }}
        onEdgeClick={(_event, edge) => {
          const edgeData = edge.data as GraphEdgeData | undefined;
          const kind = edgeData?.kind;

          if (
            kind === "dependency" &&
            edgeData?.condition === "service_healthy" &&
            edgeData.providerName &&
            edgeData.consumerName &&
            onSelectHealthEdge
          ) {
            onSelectHealthEdge({
              providerName: edgeData.providerName,
              consumerName: edgeData.consumerName,
              providerId: project.services.find((service) => service.id === edge.source)?.id
            });
            return;
          }

          if (!onDisconnectEdge) {
            return;
          }

          if (kind === "dependency") {
            // Dependency edges point provider -> consumer (see graph-builder.ts),
            // the opposite of depends_on's "consumer depends on provider"
            // reading, so the service being edited is the *target*.
            const fromService = project.services.find((service) => service.id === edge.target)?.name;
            if (!fromService) {
              return;
            }
            const toService =
              project.services.find((service) => service.id === edge.source)?.name ??
              edge.source.replace(/^external-service:/, "");
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
          setFlowReadyRevision((current) => current + 1);
        }}
      >
        {children}
        <Controls showInteractive={false} showFitView fitViewOptions={INITIAL_FIT_OPTIONS} />
      </ReactFlow>
    </div>
  );
}
