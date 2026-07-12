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
  onActivate?: (() => void) | undefined;
};

export function StraightLabeledEdge({
  id,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  markerStart,
  markerEnd,
  data,
  selected
}: EdgeProps) {
  const edgeData = (data ?? {}) as StraightEdgeData;
  const [edgePath, defaultLabelX, defaultLabelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: edgeData.kind === "dependency" ? 4 : 14,
    offset: edgeData.kind === "dependency" ? 18 : 24
  });
  const labelX = edgeData.kind === "dependency" ? sourceX + (targetX - sourceX) * 0.68 : defaultLabelX;
  const labelY = edgeData.kind === "dependency" ? sourceY + (targetY - sourceY) * 0.68 : defaultLabelY;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        {...(markerStart ? { markerStart } : {})}
        {...(markerEnd ? { markerEnd } : {})}
        style={{
          stroke: edgeData.color ?? "var(--border-strong)",
          strokeWidth: selected ? 2.6 : 1.9,
          ...(edgeData.dashed ? { strokeDasharray: "6 4" } : {})
        }}
      />
      {edgeData.label ? (
        <EdgeLabelRenderer>
          <button
            type="button"
            className="edge-label-chip"
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              borderColor: edgeData.color ?? "var(--border-strong)"
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              edgeData.onActivate?.();
            }}
          >
            {edgeData.label}
          </button>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
