import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { ServiceNodeModel } from "../../shared/contracts";

type LayoutDirection = "RIGHT" | "DOWN";
type ServiceNodeData = ServiceNodeModel & { layoutDirection: LayoutDirection };
type ServiceFlowNode = Node<ServiceNodeData, "serviceNode">;
type RegionNodeData = { label: string };
type RegionFlowNode = Node<RegionNodeData, "networkRegion">;
type VolumeNodeData = { name: string; path: string; layoutDirection: LayoutDirection };
type VolumeFlowNode = Node<VolumeNodeData, "volumeNode">;
type ExternalNodeData = { name: string; kind: string; layoutDirection: LayoutDirection };
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

// Compose images are often unresolved env interpolations, e.g.
// `${MINIO_IMAGE:-minio/minio@sha256:<64 hex chars>}`. Rendering that whole
// expression verbatim is what overflows the node - instead surface the
// meaningful part: the default image (if one is declared) or just the
// variable name. The raw string is still shown in full via the `title`
// tooltip, and CSS still clips+ellipsizes as a final safety net for any
// value that's simply long on its own (e.g. a bare unresolved digest).
function formatImageDisplay(image: string): string {
  return image.replace(/\$\{([^}:]+)(:-([^}]*))?\}/g, (_match, varName: string, _hasDefault, defaultValue?: string) =>
    defaultValue ? defaultValue : varName
  );
}

export function ServiceNode({ data }: NodeProps<ServiceFlowNode>) {
  const networkSummary =
    data.categories.networks.length > 1
      ? `${data.categories.networks[0]} +${data.categories.networks.length - 1}`
      : data.categories.networks[0] ?? "runtime networks unavailable";
  const targetHandlePosition = data.layoutDirection === "RIGHT" ? Position.Left : Position.Top;
  const sourceHandlePosition = data.layoutDirection === "RIGHT" ? Position.Right : Position.Bottom;

  const rawImage =
    data.image ?? (data.sourceHints?.dockerfilePath ? `build: ${data.sourceHints.dockerfilePath}` : "image unresolved");
  const displayImage = formatImageDisplay(rawImage);

  return (
    <div className="manifest-node">
      <Handle type="target" position={targetHandlePosition} className="graph-handle graph-handle--target" />
      <Handle type="source" position={sourceHandlePosition} className="graph-handle graph-handle--source" />
      <div className="manifest-node__header">
        <div className="manifest-node__title">
          <span className={`status-dot status-dot--${statusClass(data)} ${data.status === "running" ? "pulse" : ""}`} />
          <strong className="manifest-node__name" title={data.name}>
            {data.name}
          </strong>
        </div>
        <span className="node-state" title={data.healthStatus ?? data.status}>
          {data.healthStatus ?? data.status}
        </span>
      </div>
      <p className="manifest-node__image" title={rawImage}>
        {displayImage}
      </p>
      <div className="node-tags">
        {data.portMappings.length > 0 ? (
          data.portMappings.slice(0, 2).map((port) => (
            <span key={port.id} className={`manifest-tag manifest-tag--${port.state}`} title={port.label}>
              {port.label}
            </span>
          ))
        ) : (
          <span className="manifest-tag">no published ports</span>
        )}
        {data.portMappings.length > 2 ? <span className="manifest-tag">+{data.portMappings.length - 2} more</span> : null}
      </div>
      <div className="manifest-node__footer">
        <span className="mono-micro manifest-node__network" title={networkSummary}>
          {networkSummary}
        </span>
        {data.categories.containers.length > 1 ? (
          <span className="mono-micro manifest-node__container-count">{data.categories.containers.length} containers</span>
        ) : null}
      </div>
    </div>
  );
}

export function NetworkRegionNode({ data }: NodeProps<RegionFlowNode>) {
  return (
    <div className="network-region-node">
      <span className="network-region-node__label" title={data.label}>
        {data.label}
      </span>
    </div>
  );
}

export function VolumeNode({ data }: NodeProps<VolumeFlowNode>) {
  const sourceHandlePosition = data.layoutDirection === "RIGHT" ? Position.Right : Position.Bottom;

  return (
    <div className="volume-node">
      <Handle type="source" position={sourceHandlePosition} className="graph-handle graph-handle--volume" />
      <strong className="volume-node__name" title={data.name}>
        {data.name}
      </strong>
      <span className="mono-micro" title={data.path}>
        {data.path}
      </span>
    </div>
  );
}

export function ExternalNode({ data }: NodeProps<ExternalFlowNode>) {
  const targetHandlePosition = data.layoutDirection === "RIGHT" ? Position.Left : Position.Top;

  return (
    <div className="external-node">
      <Handle type="target" position={targetHandlePosition} className="graph-handle graph-handle--external" />
      <strong className="external-node__name" title={data.name}>
        {data.name}
      </strong>
      <span className="mono-micro" title={`external ${data.kind}`}>
        external {data.kind}
      </span>
    </div>
  );
}
