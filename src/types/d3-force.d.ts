declare module "d3-force" {
  export type SimulationNodeDatum = Record<string, unknown>;
  export type SimulationLinkDatum<NodeDatum = SimulationNodeDatum> = {
    source: NodeDatum | string;
    target: NodeDatum | string;
    [key: string]: unknown;
  };

  export type ForceHandle = {
    id(fn: (...args: any[]) => any): ForceHandle;
    distance(value: number | ((...args: any[]) => number)): ForceHandle;
    strength(value: number | ((...args: any[]) => number)): ForceHandle;
    radius(value: number | ((...args: any[]) => number)): ForceHandle;
  };

  export type SimulationHandle = {
    force(name: string, force: any): SimulationHandle;
    stop(): SimulationHandle;
    tick(iterations?: number): SimulationHandle;
  };

  export function forceSimulation<NodeDatum = SimulationNodeDatum>(nodes?: NodeDatum[]): SimulationHandle;
  export function forceLink<NodeDatum = SimulationNodeDatum, LinkDatum = SimulationLinkDatum<NodeDatum>>(
    links?: LinkDatum[]
  ): ForceHandle;
  export function forceManyBody<NodeDatum = SimulationNodeDatum>(): ForceHandle;
  export function forceCollide<NodeDatum = SimulationNodeDatum>(radius?: number | ((...args: any[]) => number)): ForceHandle;
  export function forceCenter(x?: number, y?: number): ForceHandle;
  export function forceRadial<NodeDatum = SimulationNodeDatum>(
    radius?: number | ((...args: any[]) => number),
    x?: number,
    y?: number
  ): ForceHandle;
}
