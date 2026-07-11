import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps
} from "@xyflow/react";

type StraightEdgeData = {
  kind?: "dependency" | "mount";
  label?: string;
  color?: string;
  dashed?: boolean;
};

export function StraightLabeledEdge({
  id,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  markerEnd,
  data,
  selected
}: EdgeProps) {
  const edgeData = (data ?? {}) as StraightEdgeData;
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: edgeData.kind === "dependency" ? 4 : 14,
    offset: edgeData.kind === "dependency" ? 18 : 24
  });

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        {...(markerEnd ? { markerEnd } : {})}
        style={{
          stroke: edgeData.color ?? "var(--border-strong)",
          strokeWidth: selected ? 2.6 : 1.9,
          ...(edgeData.dashed ? { strokeDasharray: "6 4" } : {})
        }}
      />
      {edgeData.label ? (
        <EdgeLabelRenderer>
          <div
            className="edge-label-chip"
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              borderColor: edgeData.color ?? "var(--border-strong)"
            }}
          >
            {edgeData.label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
