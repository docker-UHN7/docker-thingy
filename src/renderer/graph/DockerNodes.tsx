import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { ServiceNodeModel } from "../../shared/contracts";

type ServiceFlowNode = Node<ServiceNodeModel, "serviceNode">;
type RegionNodeData = { label: string };
type RegionFlowNode = Node<RegionNodeData, "networkRegion">;
type VolumeNodeData = { name: string; path: string };
type VolumeFlowNode = Node<VolumeNodeData, "volumeNode">;
type ExternalNodeData = { name: string; kind: string };
type ExternalFlowNode = Node<ExternalNodeData, "externalNode">;

function statusClass(data: ServiceNodeModel): string {
  if (data.healthStatus === "healthy") {
    return "running";
  }

  if (data.healthStatus === "starting") {
    return "warning";
  }

  if (data.healthStatus === "unhealthy") {
    return "error";
  }

  return data.status;
}

export function ServiceNode({ data }: NodeProps<ServiceFlowNode>) {
  const networkSummary =
    data.categories.networks.length > 0
      ? data.categories.networks.join(", ")
      : data.categories.containers.length > 0
        ? "network data available once running"
        : "network data available once running";

  return (
    <div className="manifest-node">
      <Handle type="target" position={Position.Left} className="graph-handle graph-handle--target" />
      <Handle type="source" position={Position.Right} className="graph-handle graph-handle--source" />
      <div className="manifest-node__header">
        <div className="manifest-node__title">
          <span className={`status-dot status-dot--${statusClass(data)} ${data.status === "running" ? "pulse" : ""}`} />
          <strong>{data.name}</strong>
        </div>
        <span className="node-state">{data.healthStatus ?? data.status}</span>
      </div>
      <p className="manifest-node__image">
        {data.image ?? (data.sourceHints?.dockerfilePath ? `build: ${data.sourceHints.dockerfilePath}` : "image unresolved")}
      </p>
      <div className="node-tags">
        {data.portMappings.length > 0 ? (
          data.portMappings.slice(0, 3).map((port) => (
            <span key={port.id} className={`manifest-tag manifest-tag--${port.state}`}>
              {port.label}
            </span>
          ))
        ) : (
          <span className="manifest-tag">no published ports</span>
        )}
        {data.portMappings.length > 3 ? <span className="manifest-tag">+{data.portMappings.length - 3} more</span> : null}
      </div>
      <div className="manifest-node__footer">
        <span className="mono-micro">{networkSummary}</span>
        {data.categories.containers.length > 1 ? (
          <span className="mono-micro">{data.categories.containers.length} containers</span>
        ) : null}
      </div>
    </div>
  );
}

export function NetworkRegionNode({ data }: NodeProps<RegionFlowNode>) {
  return (
    <div className="network-region-node">
      <span className="network-region-node__label">{data.label}</span>
    </div>
  );
}

export function VolumeNode({ data }: NodeProps<VolumeFlowNode>) {
  return (
    <div className="volume-node">
      <Handle type="source" position={Position.Right} className="graph-handle graph-handle--volume" />
      <strong>{data.name}</strong>
      <span className="mono-micro">{data.path}</span>
    </div>
  );
}

export function ExternalNode({ data }: NodeProps<ExternalFlowNode>) {
  return (
    <div className="external-node">
      <Handle type="target" position={Position.Left} className="graph-handle graph-handle--external" />
      <strong>{data.name}</strong>
      <span className="mono-micro">external {data.kind}</span>
    </div>
  );
}
