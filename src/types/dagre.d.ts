declare module 'dagre' {
  interface GraphLabel {
    rankdir?: 'TB' | 'BT' | 'LR' | 'RL'
    nodesep?: number
    ranksep?: number
    marginx?: number
    marginy?: number
  }
  interface NodeConfig {
    label?: string
    width?: number
    height?: number
  }
  interface EdgeConfig {
    label?: string
  }
  interface Edge {
    points: { x: number; y: number }[]
  }
  interface Graph {
    setGraph(label: GraphLabel): void
    setDefaultEdgeLabel(callback: () => EdgeConfig): void
    setNode(id: string, config: NodeConfig): void
    setEdge(source: string, target: string, config?: EdgeConfig): void
    node(id: string): { x: number; y: number; width: number; height: number } | undefined
    edge(source: string, target: string): Edge | undefined
    edge(e: { v: string; w: string }): Edge | undefined
    graph(): { width: number; height: number }
  }
  const graphlib: {
    Graph: new () => Graph
  }
  function layout(g: Graph): void
  export { graphlib, layout }
  export default { graphlib, layout }
}
