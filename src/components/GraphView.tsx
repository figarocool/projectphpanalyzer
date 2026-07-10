import React, { useEffect, useRef, useImperativeHandle, forwardRef, useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import cytoscape from 'cytoscape'
import type { GraphNode, GraphEdge, FileCategory, AppState } from '../types'

interface GraphViewProps {
  nodes: GraphNode[]
  edges: GraphEdge[]
  onNodeClick: (nodeId: string) => void
  onNodeDoubleClick?: (nodeId: string) => void
  layout: AppState['layout']
  selectedNode: string | null
  categoryColors: Record<FileCategory, string>
  searchQuery?: string
  showDbSubgraph?: boolean
  onShowDbTables?: () => void
  onHideDbTables?: () => void
  onGraphReady?: (ready: boolean) => void
  positions?: Record<string, { x: number; y: number }> | null
  graphView?: 'modules' | 'files'
  activeModule?: string | null
  onBackToModules?: () => void
  graphFocus?: string | null
  onClearFocus?: () => void
}

const GraphView = forwardRef<any, GraphViewProps>(({
  nodes, edges, onNodeClick, onNodeDoubleClick, layout, selectedNode, categoryColors, searchQuery,
  showDbSubgraph, onShowDbTables, onHideDbTables, onGraphReady, positions,
  graphView, activeModule, onBackToModules,
  graphFocus, onClearFocus,
}, ref) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const cyRef = useRef<cytoscape.Core | null>(null)
  const initializedRef = useRef(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)

  useImperativeHandle(ref, () => ({
    zoomToNode: (nodeId: string) => {
      if (cyRef.current) {
        cyRef.current.animate({
          fit: { eles: cyRef.current.getElementById(nodeId), padding: 100 },
          duration: 500,
        })
        cyRef.current.getElementById(nodeId).addClass('highlighted')
        setTimeout(() => {
          cyRef.current?.getElementById(nodeId).removeClass('highlighted')
        }, 2000)
      }
    },
    getCy: () => cyRef.current,
  }))

  useEffect(() => {
    if (!containerRef.current || initializedRef.current) return
    initializedRef.current = true

    const cy = cytoscape({
      container: containerRef.current,
      style: [
        {
          selector: 'node[type="file"]',
          style: {
            'background-color': '#666',
            label: 'data(displayLabel)',
            'text-valign': 'bottom',
            'text-halign': 'center',
            'text-margin-y': 4,
            color: '#ccc',
            'font-size': '10px',
            width: 60,
            height: 60,
            'border-width': 2,
            'border-color': '#444',
            'border-opacity': 0.8,
            'text-wrap': 'ellipsis',
            'text-max-width': '120px',
          },
        },
        {
          selector: 'node[type="dir"]',
          style: {
            'background-color': '#2a2a4a',
            label: 'data(label)',
            'text-valign': 'center',
            'text-halign': 'center',
            color: '#6c6c8a',
            'font-size': '10px',
            width: 30,
            height: 30,
            shape: 'round-rectangle',
            'border-width': 1,
            'border-color': '#3a3a5a',
            'background-opacity': 0.5,
          },
        },
        {
          selector: 'node[type="table"]',
          style: {
            'background-color': '#1b5e20',
            label: 'data(label)',
            'text-valign': 'bottom',
            'text-halign': 'center',
            'text-margin-y': 4,
            color: '#a5d6a7',
            'font-size': '11px',
            width: 40,
            height: 40,
            shape: 'diamond',
            'border-width': 3,
            'border-color': '#4caf50',
            'border-opacity': 1,
            'text-wrap': 'wrap',
            'text-max-width': '140px',
          },
        },
        {
          selector: 'node[type="module"]',
          style: {
            'background-color': '#2a2a4a',
            label: 'data(label)',
            'text-valign': 'center',
            'text-halign': 'center',
            color: '#e0e0e0',
            'font-size': '11px',
            'font-weight': 'bold',
            width: 120,
            height: 50,
            shape: 'round-rectangle',
            'border-width': 3,
            'border-color': '#4a4a6a',
            'text-wrap': 'ellipsis',
            'text-max-width': '110px',
          },
        },
        {
          selector: 'node[type="database"]',
          style: {
            'background-color': '#0d47a1',
            label: 'data(label)',
            'text-valign': 'center',
            'text-halign': 'center',
            color: '#90caf9',
            'font-size': '14px',
            'font-weight': 'bold',
            width: 60,
            height: 60,
            shape: 'round-octagon',
            'border-width': 4,
            'border-color': '#42a5f5',
            'background-image': 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white"><path d="M12 3C7.58 3 4 4.79 4 7v10c0 2.21 3.58 4 8 4s8-1.79 8-4V7c0-2.21-3.58-4-8-4zm0 2c3.87 0 6 1.5 6 2s-2.13 2-6 2-6-1.5-6-2 2.13-2 6-2zM4 17v-2.11c1.61.98 4.26 1.61 8 1.61s6.39-.63 8-1.61V17c0 .5-2.13 2-8 2s-8-1.5-8-2z"/></svg>',
            'background-fit': 'contain',
            'background-width': '40%',
            'background-height': '40%',
            'background-position-x': '50%',
            'background-position-y': '40%',
          },
        },
        {
          selector: 'node[hasClasses="true"]',
          style: {
            'border-width': 3,
          },
        },
        {
          selector: 'node[hasDb="true"]',
          style: {
            'border-style': 'dashed',
            'border-color': '#66bb6a',
            'border-width': 3,
          },
        },
        {
          selector: 'edge',
          style: {
            width: 1.5,
            'line-color': '#3a3a5a',
            'target-arrow-color': '#3a3a5a',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            'arrow-scale': 1,
            'line-opacity': 0.6,
          },
        },
        {
          selector: 'edge[label="use"]',
          style: {
            'line-color': '#4fc3f7',
            'target-arrow-color': '#4fc3f7',
            'line-opacity': 0.5,
          },
        },
        {
          selector: 'edge[label="include"]',
          style: {
            'line-color': '#81c784',
            'target-arrow-color': '#81c784',
            'line-style': 'dashed',
          },
        },
        {
          selector: 'edge[label="require"]',
          style: {
            'line-color': '#ffa726',
            'target-arrow-color': '#ffa726',
            'line-style': 'dotted',
          },
        },
        {
          selector: 'edge[type="db"]',
          style: {
            'line-color': '#42a5f5',
            'target-arrow-color': '#42a5f5',
            'line-style': 'dashed',
            'line-opacity': 0.8,
            width: 2,
            'target-arrow-shape': 'triangle',
            'arrow-scale': 1.5,
            label: 'data(label)',
            color: '#90caf9',
            'font-size': '9px',
            'text-background-color': '#1a1a2e',
            'text-background-opacity': 0.8,
            'text-background-padding': 2,
            'text-rotation': 'autorotate',
          },
        },
        {
          selector: 'node.search-match',
          style: {
            'border-color': '#ffeb3b',
            'border-width': 3,
            'shadow-blur': 15 as any,
            'shadow-color': '#ffeb3b',
            'shadow-opacity': 0.6,
          } as any,
        },
        {
          selector: 'node.highlighted',
          style: {
            'border-color': '#fff',
            'border-width': 4,
            'shadow-blur': 20 as any,
            'shadow-color': '#4fc3f7',
            'shadow-opacity': 0.8,
          } as any,
        },
        {
          selector: 'node.selected',
          style: {
            'border-color': '#4fc3f7',
            'border-width': 4,
            'shadow-blur': 15 as any,
            'shadow-color': '#4fc3f7',
            'shadow-opacity': 0.6,
          } as any,
        },
        {
          selector: 'edge.highlighted',
          style: {
            width: 3,
            'line-opacity': 1,
            'line-color': '#4fc3f7',
            'target-arrow-color': '#4fc3f7',
          },
        },
      ],
      wheelSensitivity: 0.3,
      minZoom: 0.05,
      maxZoom: 4,
    })

    cyRef.current = cy

    cy.on('tap', 'node', (evt) => {
      const node = evt.target
      const id = node.data('id')
      onNodeClick(id)
    })

    cy.on('tap', (evt) => {
      if (evt.target === cy) {
        onNodeClick('')
      }
      setContextMenu(null)
    })

    cy.on('cxttap', 'node', (evt) => {
      const id = evt.target.data('id')
      if (id === '_database') {
        setContextMenu({ x: evt.renderedPosition.x, y: evt.renderedPosition.y })
      }
    })

    cy.on('dblclick', (evt) => {
      if (evt.target === cy) {
        cy.zoom({ level: cy.zoom() * 1.8, renderedPosition: { x: evt.renderedPosition.x, y: evt.renderedPosition.y } })
      }
    })

    cy.on('dblclick', 'node', (evt) => {
      const node = evt.target
      cy.fit(node, 80)
      setTimeout(() => onNodeDoubleClick?.(node.id()), 100)
    })

    const handleResize = () => {
      setTimeout(() => cy.resize(), 100)
    }
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      cy.destroy()
      initializedRef.current = false
    }
  }, [])

  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    const q = (searchQuery || '').toLowerCase().trim()
    if (!q) {
      cy.nodes().removeClass('search-match').style('opacity', 1)
      cy.edges().style('opacity', 1)
      return
    }
    const matched = cy.nodes().filter(n => (n.data('label') || '').toLowerCase().includes(q) || (n.data('id') || '').toLowerCase().includes(q))
    const others = cy.nodes().not(matched)
    matched.addClass('search-match')
    others.style('opacity', 0.2)
    cy.edges().style('opacity', 0.1)
    if (matched.length > 0) cy.fit(matched, 100)
  }, [searchQuery])

  useEffect(() => {
    console.log(`GraphView update start: ${nodes.length} nodes, ${edges.length} edges`)
    try {
      const cy = cyRef.current
      if (!cy) {
        console.log('GraphView: cy not ready')
        onGraphReady?.(false)
        return
      }

      const existingNodes = cy.nodes().map(n => n.data('id'))
      const existingEdges = cy.edges().map(e => e.data('id'))
      console.log(`GraphView existing: ${existingNodes.length} nodes, ${existingEdges.length} edges`)

      const newNodeIds = new Set(nodes.map(n => n.id))
      const newEdgeIds = new Set(edges.map(e => e.id))

      const toRemove = [
        ...existingNodes.filter(id => !newNodeIds.has(id)),
        ...existingEdges.filter(id => !newEdgeIds.has(id)),
      ]
      if (toRemove.length > 0) {
        const sel = cy.collection()
        toRemove.forEach(id => {
          const el = cy.getElementById(id)
          if (el.length > 0) sel.merge(el)
        })
        cy.remove(sel)
      }

      const currentIds = new Set(cy.nodes().map(n => n.data('id')))

      const formatSize = (bytes: number) => bytes > 1024 ? `${(bytes / 1024).toFixed(0)}k` : `${bytes}B`

      const nodesToAdd = nodes.filter(n => !currentIds.has(n.id)).map(n => ({
        group: 'nodes' as const,
        data: {
          id: n.id,
          label: n.label.length > 20 ? n.label.substring(0, 18) + '...' : n.label,
          displayLabel: `${n.label.length > 18 ? n.label.substring(0, 16) + '...' : n.label} (${formatSize(n.size)})`,
          type: n.type,
          category: n.category,
          size: Math.max(40, Math.min(100, 40 + n.size / 5000)),
          fileSize: n.size,
          lines: n.lines,
          hasClasses: n.classes.length > 0 ? 'true' : 'false',
          hasDb: n.dbTables.length > 0 ? 'true' : 'false',
          classes: n.classes,
          dbTables: n.dbTables,
          fullPath: n.path,
        },
      }))

      const edgeCurrentIds = new Set(cy.edges().map(e => e.data('id')))
      const edgesToAdd = edges.filter(e => !edgeCurrentIds.has(e.id)).map(e => ({
        group: 'edges' as const,
        data: { id: e.id, source: e.source, target: e.target, label: e.label, type: e.type },
      }))

      console.log(`cy.add: ${nodesToAdd.length} nodes, ${edgesToAdd.length} edges`)
      cy.add([...nodesToAdd, ...edgesToAdd] as any)
      console.log('cy.add done')

      nodesToAdd.forEach((n: any) => {
        const node = cy.getElementById(n.data.id)
        const category = n.data.category as FileCategory
        const color = categoryColors[category] || '#90a4ae'
        node.style('background-color', color)
        const size = Math.max(8, Math.min(30, 8 + n.data.fileSize / 10000))
        node.style('width', size * 2)
        node.style('height', size * 2)
      })

      edgesToAdd.forEach((e: any) => {
        if (e.data.type === 'dir') {
          const edge = cy.getElementById(e.data.id)
          edge.style('line-opacity', 0.15)
          edge.style('width', 0.5)
        }
      })

      if (positions) {
        const toPos: Record<string, any> = {}
        nodes.forEach(n => {
          const p = positions[n.id]
          if (p) toPos[n.id] = p
        })
        if (Object.keys(toPos).length > 0) {
          cy.nodes().positions((n: any) => toPos[n.id()] || { x: 0, y: 0 })
          cy.resize()
          const positioned = cy.nodes().filter((n: any) => toPos[n.id()])
          if (positioned.length > 0) {
            requestAnimationFrame(() => { (cy as any).fit(positioned, 50) })
          }
        }
        onGraphReady?.(false)
      } else {
        const needsLayout = nodesToAdd.length > 0 || (nodes.length > 0 && existingNodes.length === 0)
        if (needsLayout) {
          setTimeout(() => {
            try {
              console.log(`runLayout: start layout=${layout}`)
              runLayout(cy, layout)
              console.log('runLayout: done')
            } catch (err) {
              console.error('runLayout error:', err)
              onGraphReady?.(false)
            }
          }, 100)
        } else {
          onGraphReady?.(false)
        }
      }
    } catch (err) {
      console.error('GraphView update error:', err)
      onGraphReady?.(false)
    }
  }, [nodes, edges, categoryColors, layout, positions])

  useEffect(() => {
    const cy = cyRef.current
    if (cy && nodes.length > 0) {
      runLayout(cy, layout)
    }
  }, [layout])

  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return

    cy.nodes().removeClass('selected highlighted')
    cy.edges().removeClass('highlighted')

    if (selectedNode) {
      const node = cy.getElementById(selectedNode)
      if (node.length > 0) {
        node.addClass('selected')
        node.neighborhood().edges().addClass('highlighted')
        node.neighborhood().nodes().addClass('highlighted')
      }
    }
  }, [selectedNode])

  const runLayout = useCallback((cy: cytoscape.Core, layoutName: string) => {
    const base = { animate: false, fit: false, padding: 50 }
    let layoutConfig: any

    switch (layoutName) {
      case 'breadthfirst':
        layoutConfig = { ...base, name: 'breadthfirst', directed: true, spacingFactor: 2, avoidOverlap: true }
        break
      case 'cose':
        layoutConfig = { ...base, name: 'cose', idealEdgeLength: 400, nodeOverlap: 80, refresh: 10, componentSpacing: 500, nodeRepulsion: 200000, edgeElasticity: 200, gravity: 0.05, numIter: 300, randomize: false }
        break
      case 'concentric':
        layoutConfig = { ...base, name: 'concentric', concentric: (node: any) => node.data('lines') || 0, levelWidth: () => 2, spacingFactor: 2 }
        break
      default:
        layoutConfig = { ...base, name: 'cose', idealEdgeLength: 400, nodeOverlap: 80, refresh: 10, componentSpacing: 500, nodeRepulsion: 200000, edgeElasticity: 200, gravity: 0.05, numIter: 300, randomize: false }
    }

    const layout = cy.layout(layoutConfig)
    const timeout = setTimeout(() => {
      try { layout.stop() } catch (e) {}
      onGraphReady?.(false)
    }, 30000)
    layout.one('layoutstop', () => {
      clearTimeout(timeout)
      onGraphReady?.(false)
    })
    layout.run()
    onGraphReady?.(true)
  }, [onGraphReady])

  const tableCount = nodes.filter(n => n.type === 'table').length

  return (
    <div
      ref={containerRef}
      className="cytoscape-container"
      style={{ width: '100%', height: '100%', position: 'relative' }}
    >
      {graphView === 'files' && !showDbSubgraph && !graphFocus && (
        <div style={{
          position: 'absolute', top: 8, left: 8, zIndex: 20,
          background: 'rgba(26,26,46,0.95)', border: '1px solid #2a2a4a', borderRadius: 6,
          padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <button className="btn btn-small" onClick={onBackToModules}>
            ← Moduli
          </button>
          <span style={{ color: '#90caf9', fontSize: 12 }}>{nodes.length} file · {edges.length} dipendenze</span>
        </div>
      )}
      {graphView === 'files' && graphFocus && (
        <div style={{
          position: 'absolute', top: 8, left: 8, zIndex: 20,
          background: 'rgba(26,46,36,0.95)', border: '1px solid #2a6a4a', borderRadius: 6,
          padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <button className="btn btn-small" onClick={onClearFocus}>
            ← Mostra tutto
          </button>
          <span style={{ color: '#81c784', fontSize: 12 }}>{nodes.length} nodi · {edges.length} dipendenze</span>
        </div>
      )}
      {showDbSubgraph && (
        <div style={{
          position: 'absolute', top: 8, left: 8, zIndex: 20,
          background: 'rgba(26,26,46,0.95)', border: '1px solid #2a2a4a', borderRadius: 6,
          padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <button className="btn btn-small" onClick={onHideDbTables}>
            ← Torna al grafico
          </button>
          <span style={{ color: '#90caf9', fontSize: 12 }}>🗄️ {tableCount} tabelle · {nodes.length - tableCount} file</span>
        </div>
      )}

      {contextMenu && createPortal(
        <div
          style={{
            position: 'fixed', left: contextMenu.x, top: contextMenu.y, zIndex: 9999,
            background: '#1a1a2e', border: '1px solid #2a2a4a', borderRadius: 6,
            padding: '4px 0', minWidth: 180, boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
          }}
          onClick={() => setContextMenu(null)}
        >
          <div
            style={{
              padding: '8px 16px', cursor: 'pointer', color: '#e0e0e0', fontSize: 13,
              display: 'flex', alignItems: 'center', gap: 8,
            }}
            onClick={(e) => { e.stopPropagation(); onShowDbTables?.(); setContextMenu(null) }}
            onMouseEnter={e => (e.currentTarget.style.background = '#2a2a4a')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            🗄️ Mostra tabelle
          </div>
        </div>,
        document.body
      )}
    </div>
  )
})

GraphView.displayName = 'GraphView'

export default GraphView
