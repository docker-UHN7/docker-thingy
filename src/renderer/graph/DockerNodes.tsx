import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { PortMapping, ServiceNodeModel } from "../../shared/contracts";

type ServiceFlowNode = Node<ServiceNodeModel, "serviceNode">;
type ProjectFlowNode = Node<{ isRoot: true; name: string; subtitle: string }, "projectNode">;
type VolumeFlowNode = Node<{ name: string; path: string; consumerCount?: number }, "volumeNode">;
type ExternalFlowNode = Node<{ name: string; kind: string }, "externalNode">;

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

function formatImageDisplay(image: string): string {
  return image.replace(/\$\{([^}:]+)(:-([^}]*))?\}/g, (_match, varName: string, _hasDefault, defaultValue?: string) =>
    defaultValue ? defaultValue : varName
  );
}

function portTargetUrl(port: PortMapping): string | undefined {
  if (port.state !== "published" || !port.hostPort) {
    return undefined;
  }

  const rawHost = port.hostIp?.trim();
  const host =
    !rawHost || rawHost === "0.0.0.0" || rawHost === "::" || rawHost === ":::" || rawHost === "[::]"
      ? "localhost"
      : rawHost;

  return `http://${host}:${port.hostPort}`;
}

async function openPort(port: PortMapping): Promise<void> {
  const target = portTargetUrl(port);
  if (!target) {
    return;
  }

  try {
    await window.dockerExplorer.openExternalUrl(target);
  } catch (error) {
    console.error("Failed to open published port", { port, error });
  }
}

export function ProjectNode({ data }: NodeProps<ProjectFlowNode>) {
  return (
    <div className="project-hub-node">
      <span className="project-hub-node__eyebrow">Compose project</span>
      <strong className="project-hub-node__name" title={data.name}>
        {data.name}
      </strong>
      <span className="mono-micro project-hub-node__subtitle" title={data.subtitle}>
        {data.subtitle}
      </span>
    </div>
  );
}

export function ServiceNode({ data }: NodeProps<ServiceFlowNode>) {
  const networkSummary =
    data.categories.networks.length > 1
      ? `${data.categories.networks[0]} +${data.categories.networks.length - 1}`
      : data.categories.networks[0] ?? "runtime networks unavailable";

  const rawImage =
    data.image ?? (data.sourceHints?.dockerfilePath ? `build: ${data.sourceHints.dockerfilePath}` : "image unresolved");
  const displayImage = formatImageDisplay(rawImage);

  return (
    <div className="manifest-node">
      <Handle id="dependency-in" type="target" position={Position.Top} className="graph-handle graph-handle--hidden" />
      <Handle id="dependency-out" type="source" position={Position.Bottom} className="graph-handle graph-handle--hidden" />
      <Handle id="storage" type="target" position={Position.Right} className="graph-handle graph-handle--hidden" />
      <div className="manifest-node__eyebrow-row">
        <span className="manifest-node__eyebrow">Service</span>
        {data.details?.containerId ? (
          <span className="manifest-node__meta mono-micro" title={data.details.containerId}>
            {data.details.containerId.slice(0, 12)}
          </span>
        ) : null}
      </div>
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
            <button
              key={port.id}
              type="button"
              className={`manifest-tag manifest-tag--${port.state} ${port.state === "published" && port.hostPort ? "manifest-tag--interactive" : ""}`}
              title={port.state === "published" && port.hostPort ? `${port.label} - open in browser` : port.label}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void openPort(port);
              }}
            >
              {port.label}
            </button>
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

export function VolumeNode({ data }: NodeProps<VolumeFlowNode>) {
  return (
    <div className="volume-node">
      <Handle id="resource-out" type="source" position={Position.Left} className="graph-handle graph-handle--hidden" />
      <span className="volume-node__eyebrow">Volume</span>
      <strong className="volume-node__name" title={data.name}>
        {data.name}
      </strong>
      <span className="volume-node__detail mono-micro" title={data.path}>
        {data.consumerCount && data.consumerCount > 1 ? `${data.consumerCount} services` : data.path}
      </span>
    </div>
  );
}

export function ExternalNode({ data }: NodeProps<ExternalFlowNode>) {
  return (
    <div className="external-node">
      <Handle id="dependency-out" type="source" position={Position.Bottom} className="graph-handle graph-handle--hidden" />
      <span className="external-node__eyebrow">External {data.kind}</span>
      <strong className="external-node__name" title={data.name}>
        {data.name}
      </strong>
      <span className="external-node__detail mono-micro">Dependency</span>
    </div>
  );
}
