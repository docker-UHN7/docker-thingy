import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { TopologyNode as TopologyNodeModel } from "../../shared/network-contracts";

type TopologyFlowNode = Node<TopologyNodeModel, "topologyNode">;
type UplinkNodeData = TopologyNodeModel;
type UplinkFlowNode = Node<UplinkNodeData, "uplinkNode">;

export function TopologyNode({ data }: NodeProps<TopologyFlowNode>) {
  return (
    <div className={`topology-node topology-node--${data.kind}`}>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      <div className="topology-node__title">
        <span className={`status-dot status-dot--${data.status === "up" ? "running" : data.status === "down" ? "stopped" : "unknown"} ${data.status === "up" ? "pulse" : ""}`} />
        <strong className="topology-node__name" title={data.name}>
          {data.name}
        </strong>
      </div>
      <span className="topology-node__kind">{data.kind}</span>
      {data.detail ? (
        <p className="topology-node__detail" title={data.detail}>
          {data.detail}
        </p>
      ) : null}
    </div>
  );
}

export function UplinkNode({ data }: NodeProps<UplinkFlowNode>) {
  return (
    <div className="topology-uplink-node">
      <Handle type="target" position={Position.Left} />
      <span
        className={`status-dot status-dot--${data.status === "up" ? "running" : data.status === "down" ? "error" : "unknown"}`}
      />
      <span className="topology-uplink-node__name" title={data.name}>
        {data.name}
      </span>
    </div>
  );
}
