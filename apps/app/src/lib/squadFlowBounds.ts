export interface FlowPoint {
  x: number;
  y: number;
}

export interface FlowRect extends FlowPoint {
  width: number;
  height: number;
}

export interface FlowBounds {
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}

/** Bounds node bodies and routed edge waypoints, with room for SVG markers. */
export function squadFlowBounds(
  nodes: readonly FlowRect[],
  edgePoints: readonly FlowPoint[],
  baseWidth: number,
  baseHeight: number,
  markerPadding: number
): FlowBounds {
  const xs = edgePoints.map((point) => point.x);
  const ys = edgePoints.map((point) => point.y);
  for (const node of nodes) {
    xs.push(node.x, node.x + node.width);
    ys.push(node.y, node.y + node.height);
  }

  const minX = Math.min(0, ...xs) - markerPadding;
  const minY = Math.min(0, ...ys) - markerPadding;
  const maxX = Math.max(baseWidth, ...xs) + markerPadding;
  const maxY = Math.max(baseHeight, ...ys) + markerPadding;
  return {
    offsetX: -minX,
    offsetY: -minY,
    width: maxX - minX,
    height: maxY - minY
  };
}
