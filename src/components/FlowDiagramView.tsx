import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react'
import type { ProjectAnalysis, FlowNode, FlowEdge } from '../types'
import dagre from 'dagre'

const NODE_W = 160
const NODE_H = 30
const COL_GAP = 40
const FILE_HEADER_H = 40

function nodeColor(type: string): string {
  switch (type) {
    case 'entry': return '#1b5e20'
    case 'function':
    case 'method': return '#0d47a1'
    case 'if': return '#e65100'
    case 'elseif': return '#bf360c'
    case 'else': return '#3e2723'
    case 'foreach':
    case 'for':
    case 'while':
    case 'dowhile': return '#4a148c'
    case 'switch':
    case 'case': return '#880e4f'
    case 'try': return '#33691e'
    case 'catch': return '#bf360c'
    case 'return': return '#1a237e'
    case 'throw': return '#b71c1c'
    case 'call': return '#00695c'
    case 'include': return '#33691e'
    case 'block': return '#263238'
    case 'class': return '#01579b'
    case 'assign': return '#37474f'
    default: return '#37474f'
  }
}

function nodeIcon(type: string): string {
  switch (type) {
    case 'entry': return '▶'
    case 'function': return 'ƒ'
    case 'method': return 'λ'
    case 'if':
    case 'elseif':
    case 'else': return '◇'
    case 'foreach':
    case 'for':
    case 'while':
    case 'dowhile': return '⟳'
    case 'switch':
    case 'case': return '◎'
    case 'try': return '↑'
    case 'catch': return '↓'
    case 'return': return '←'
    case 'throw': return '✕'
    case 'call': return '►'
    case 'include': return '▸'
    case 'block': return '▢'
    default: return '●'
  }
}

interface FileLayout {
  filePath: string
  nodes: (FlowNode & { x: number; y: number; w: number; h: number })[]
  edges: (FlowEdge & { points: { x: number; y: number }[] })[]
  width: number
  height: number
  xOffset: number
  entryNode?: FlowNode & { x: number; y: number; w: number; h: number }
  includeNodes: (FlowNode & { x: number; y: number; w: number; h: number })[]
}

export default function FlowDiagramView({
  analysis, searchQuery, onFileSelect,
}: {
  analysis: ProjectAnalysis; searchQuery?: string; onFileSelect?: (path: string) => void
}) {
  const [openFiles, setOpenFiles] = useState<string[]>([])
  const [q, setQ] = useState('')
  const [filterTypes, setFilterTypes] = useState<Set<string>>(new Set())
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const [panStart, setPanStart] = useState({ x: 0, y: 0 })
  const [showTables, setShowTables] = useState(true)
  const svgRef = useRef<SVGSVGElement>(null)

  const fileList = useMemo(() => {
    return analysis.files
      .filter(f => f.relativePath.endsWith('.php'))
      .sort((a, b) => a.relativePath.localeCompare(b.relativePath))
  }, [analysis])

  useEffect(() => {
    if (openFiles.length === 0 && fileList.length > 0) {
      setOpenFiles([fileList[0].relativePath])
    }
  }, [fileList])

  const getFile = useCallback((fp: string) => fileList.find(f => f.relativePath === fp) || null, [fileList])

  const selectFile = useCallback((fp: string) => {
    setOpenFiles([fp])
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [])

  const addFile = useCallback((fp: string) => {
    setOpenFiles(prev => prev.includes(fp) ? prev : [...prev, fp])
  }, [])

  const removeFile = useCallback((fp: string) => {
    setOpenFiles(prev => {
      const next = prev.filter(p => p !== fp)
      return next
    })
  }, [])

  const filterNodeTypes = useCallback((type: string) => {
    setFilterTypes(prev => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }, [])

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      const delta = e.deltaY > 0 ? -0.1 : 0.1
      setZoom(z => Math.max(0.2, Math.min(5, z + delta)))
    }
  }, [])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 0) {
      setIsPanning(true)
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y })
    }
  }, [pan])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isPanning) {
      setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y })
    }
  }, [isPanning, panStart])

  const handleMouseUp = useCallback(() => setIsPanning(false), [])

  const resetZoom = useCallback(() => { setZoom(1); setPan({ x: 0, y: 0 }) }, [])

  // Compute layouts for each open file
  const layouts = useMemo(() => {
    const result: FileLayout[] = []
    let xOffset = 0
    for (const fp of openFiles) {
      const f = getFile(fp)
      if (!f?.flowGraph) continue
      const { nodes, edges } = f.flowGraph
      if (nodes.length === 0) continue

      const g = new dagre.graphlib.Graph()
      g.setGraph({ rankdir: 'TB', nodesep: 12, ranksep: 36, marginx: 8, marginy: 8 })
      g.setDefaultEdgeLabel(() => ({}))

      const shown = filterTypes.size > 0 ? nodes.filter(n => filterTypes.has(n.type)) : nodes
      const shownIds = new Set(shown.map(n => n.id))

      shown.forEach(n => g.setNode(String(n.id), { label: n.label, width: NODE_W, height: NODE_H }))
      edges.forEach(e => {
        if (shownIds.has(e.source) && shownIds.has(e.target))
          g.setEdge(String(e.source), String(e.target), { label: e.label })
      })

      dagre.layout(g)

      const laidOutNodes = shown.map(n => {
        const gn = g.node(String(n.id))
        if (!gn) return null
        return { ...n, x: gn.x - NODE_W / 2, y: gn.y - NODE_H / 2, w: NODE_W, h: NODE_H }
      }).filter(Boolean) as (FlowNode & { x: number; y: number; w: number; h: number })[]

      const laidOutEdges = edges.filter(e => {
        if (!shownIds.has(e.source) || !shownIds.has(e.target)) return false
        const edge = g.edge(String(e.source), String(e.target))
        return !!(edge?.points && edge.points.length >= 2)
      }).map(e => {
        const edge = g.edge(String(e.source), String(e.target))
        return { ...e, points: edge!.points! }
      })

      const gw = g.graph().width || 600
      const gh = (g.graph().height || 300) + FILE_HEADER_H + 10

      const entryNode = laidOutNodes.find(n => n.type === 'entry')
      const includeNodes = laidOutNodes.filter(n => n.type === 'include')

      result.push({
        filePath: fp,
        nodes: laidOutNodes,
        edges: laidOutEdges,
        width: gw + 16,
        height: Math.max(gh, 200),
        xOffset,
        entryNode,
        includeNodes,
      })
      xOffset += gw + 16 + COL_GAP
    }
    return result
  }, [openFiles, filterTypes])

  // Cross-file connections
  const crossEdges = useMemo(() => {
    const edges: { fromX: number; fromY: number; toX: number; toY: number; label: string }[] = []
    for (const layout of layouts) {
      const f = getFile(layout.filePath)
      for (const incNode of layout.includeNodes) {
        const m = incNode.label.match(/'([^']+)'/)
        if (!m) continue
        const target = m[1]
        const targetLayout = layouts.find(l => {
          const lf = getFile(l.filePath)
          return lf && (lf.relativePath === target || lf.relativePath.endsWith('/' + target) || target.endsWith(lf.relativePath.split('/').pop()!))
        })
        if (targetLayout && targetLayout.entryNode) {
          edges.push({
            fromX: layout.xOffset + incNode.x + NODE_W,
            fromY: FILE_HEADER_H + incNode.y + NODE_H / 2,
            toX: targetLayout.xOffset + targetLayout.entryNode.x,
            toY: FILE_HEADER_H + targetLayout.entryNode.y + NODE_H / 2,
            label: incNode.label.split(' ')[0],
          })
        }
      }
    }
    return edges
  }, [layouts])

  const totalWidth = layouts.length > 0 ? Math.max(layouts[layouts.length - 1].xOffset + layouts[layouts.length - 1].width, 600) : 600
  const totalHeight = layouts.length > 0 ? Math.max(...layouts.map(l => l.height), 300) : 300

  // Table data for each open file
  const tablesData = useMemo(() => {
    return openFiles.map(fp => {
      const f = getFile(fp)
      if (!f?.dbReferences?.length) return null
      const tableMap = new Map<string, { columns: Map<string, Set<string>>; operations: Set<string> }>()
      for (const ref of f.dbReferences) {
        if (!tableMap.has(ref.table)) tableMap.set(ref.table, { columns: new Map(), operations: new Set() })
        const t = tableMap.get(ref.table)!
        t.operations.add(ref.operation)
        const cols = extractColsSimple(ref.context)
        cols.forEach(col => {
          if (!t.columns.has(col)) t.columns.set(col, new Set())
          t.columns.get(col)!.add(ref.operation)
        })
      }
      return { filePath: fp, tables: [...tableMap.entries()].map(([name, data]) => ({
        name,
        columns: [...data.columns.entries()].map(([c, ops]) => ({ name: c, ops: [...ops] })),
        operations: [...data.operations],
      })) }
    }).filter(Boolean) as { filePath: string; tables: { name: string; columns: { name: string; ops: string[] }[]; operations: string[] }[] }[]
  }, [openFiles])

  const handleIncludeClick = useCallback((label: string) => {
    const m = label.match(/'([^']+)'/)
    if (!m) return
    const target = m[1]
    const found = fileList.find(f =>
      f.relativePath === target || f.relativePath.endsWith('/' + target) || target.endsWith(f.relativePath.split('/').pop()!)
    )
    if (found) addFile(found.relativePath)
  }, [fileList, addFile])

  const totalDbRefs = tablesData.reduce((s, t) => s + t.tables.reduce((s2, t2) => s2 + t2.columns.length, 0), 0)

  return (
    <div className="flow-container">
      <div className="flow-sidebar">
        <div className="flow-sidebar-header">
          <input className="flow-search" placeholder="Cerca file..."
            value={q} onChange={e => setQ(e.target.value)} />
          <span className="flow-count">{fileList.length} file</span>
        </div>
        <div className="flow-file-list">
          {fileList.filter(f => !q || f.relativePath.toLowerCase().includes(q.toLowerCase())).map(f => {
            return (
              <div key={f.relativePath}
                className={`flow-file-item ${openFiles[0] === f.relativePath ? 'selected' : ''}`}
                onClick={() => selectFile(f.relativePath)}
                onDoubleClick={() => onFileSelect?.(f.relativePath)}
              >
                <span className="flow-file-name">{f.relativePath.split('/').pop()}</span>
                <span className="flow-file-nodes">{f.flowGraph?.nodes.length ? `${f.flowGraph.nodes.length} nodi` : ''}</span>
              </div>
            )
          })}
        </div>
      </div>

      <div className="flow-diagram">
        {layouts.length > 0 && (
          <div className="flow-tabs">
            <div className="flow-tabs-left">
              {openFiles.map((fp, i) => (
                <div key={fp} className={`flow-tab ${i === 0 ? 'active' : ''}`}>
                  <span className="flow-tab-name">{fp.split('/').pop()}</span>
                  <button className="flow-tab-close" onClick={() => removeFile(fp)}>×</button>
                </div>
              ))}
            </div>
            <div className="flow-legend-bar">
              {layouts.length === 1 && (() => {
                const f = getFile(openFiles[0])
                if (!f?.flowGraph) return null
                const counts = new Map<string, number>()
                for (const n of f.flowGraph.nodes) counts.set(n.type, (counts.get(n.type) || 0) + 1)
                return [...counts.entries()].map(([type, count]) => (
                  <button key={type}
                    className={`flow-type-btn ${filterTypes.has(type) ? 'active' : ''}`}
                    style={{ '--flow-color': nodeColor(type) } as React.CSSProperties}
                    onClick={() => filterNodeTypes(type)}
                  >
                    {nodeIcon(type)} {type} ({count})
                  </button>
                ))
              })()}
              {filterTypes.size > 0 && (
                <button className="flow-type-btn flow-clear" onClick={() => setFilterTypes(new Set())}>
                  × Mostra tutti
                </button>
              )}
            </div>
          </div>
        )}
        {layouts.length > 0 ? (
          <div className="flow-svg-wrapper"
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            style={{ cursor: isPanning ? 'grabbing' : 'grab' }}
          >
            <div style={{ transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`, transformOrigin: '0 0' }}>
              <svg ref={svgRef} className="flow-svg" viewBox={`0 0 ${totalWidth} ${totalHeight}`}>
                <defs>
                  <marker id="flow-arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="5" markerHeight="5" orient="auto">
                    <path d="M 0 0 L 10 5 L 0 10 Z" fill="#42a5f5" />
                  </marker>
                  <marker id="flow-arrow-green" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="5" markerHeight="5" orient="auto">
                    <path d="M 0 0 L 10 5 L 0 10 Z" fill="#66bb6a" />
                  </marker>
                </defs>
                {layouts.map((layout, li) => (
                  <g key={`col-${li}`} transform={`translate(${layout.xOffset}, ${FILE_HEADER_H})`}>
                    <text x={8} y={-20} fill="#90caf9" fontSize={12} fontFamily="monospace" fontWeight="bold">
                      📄 {layout.filePath.split('/').pop()}
                    </text>
                    <text x={8} y={-8} fill="#6c6c8a" fontSize={9}>
                      {layout.filePath}
                    </text>
                    {layout.edges.map(e => (
                      <g key={`e-${layout.filePath}-${e.source}-${e.target}`}>
                        <polyline points={e.points.map(p => `${p.x},${p.y}`).join(' ')}
                          fill="none" stroke="#42a5f5" strokeWidth={1.5} strokeOpacity={0.35}
                          markerEnd="url(#flow-arrow)" />
                        {e.label && e.points.length >= 2 && (() => {
                          const mid = Math.floor(e.points.length / 2)
                          return (
                            <text x={e.points[mid].x} y={e.points[mid].y - 5} textAnchor="middle"
                              fill="#90caf9" fontSize={8} stroke="#0f0f1a" strokeWidth={2}
                              strokeLinejoin="round" paintOrder="stroke">
                              {e.label}
                            </text>
                          )
                        })()}
                      </g>
                    ))}
                    {layout.nodes.map(n => {
                      const isInclude = n.type === 'include'
                      return (
                        <g key={`n-${layout.filePath}-${n.id}`} className="flow-node"
                          onClick={() => isInclude ? handleIncludeClick(n.label) : undefined}
                          onDoubleClick={() => onFileSelect?.(layout.filePath)}
                          style={{ cursor: isInclude ? 'pointer' : 'default' }}
                        >
                          <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={4}
                            fill={nodeColor(n.type)} stroke={isInclude ? '#66bb6a' : '#2a2a4a'} strokeWidth={isInclude ? 2 : 1}
                            opacity={n.type === 'block' ? 0.5 : 0.85}
                          />
                          <text x={n.x + 12} y={n.y + n.h / 2} textAnchor="middle"
                            dominantBaseline="central" fill="rgba(255,255,255,0.6)" fontSize={9}>
                            {nodeIcon(n.type)}
                          </text>
                          <text x={n.x + 20} y={n.y + n.h / 2}
                            dominantBaseline="central" fill="#e0e0e0" fontSize={9} fontFamily="monospace">
                            {n.label.length > 28 ? n.label.slice(0, 28) + '…' : n.label}
                          </text>
                        </g>
                      )
                    })}
                  </g>
                ))}
                {crossEdges.map((ce, i) => (
                  <g key={`cross-${i}`}>
                    <line x1={ce.fromX} y1={ce.fromY} x2={ce.toX} y2={ce.toY}
                      stroke="#66bb6a" strokeWidth={2} strokeDasharray="6,3" strokeOpacity={0.7}
                      markerEnd="url(#flow-arrow-green)"
                    />
                    {ce.label && (
                      <text x={(ce.fromX + ce.toX) / 2} y={(ce.fromY + ce.toY) / 2 - 4}
                        textAnchor="middle" fill="#81c784" fontSize={9}
                        stroke="#0f0f1a" strokeWidth={2} strokeLinejoin="round" paintOrder="stroke">
                        {ce.label}
                      </text>
                    )}
                  </g>
                ))}
              </svg>
            </div>
            <div className="flow-zoom-bar">
              <button className="flow-zoom-btn" onClick={() => setZoom(z => Math.max(0.2, z - 0.2))}>−</button>
              <span className="flow-zoom-label">{Math.round(zoom * 100)}%</span>
              <button className="flow-zoom-btn" onClick={() => setZoom(z => Math.min(5, z + 0.2))}>+</button>
              <button className="flow-zoom-btn" onClick={resetZoom}>⟲</button>
            </div>
          </div>
        ) : (
          <div className="flow-empty">Seleziona un file per vedere il diagramma di flusso</div>
        )}
        {tablesData.length > 0 && tablesData.some(td => td.tables.length > 0) && (
          <div className="flow-tables">
            <div className="flow-tables-header" onClick={() => setShowTables(s => !s)}>
              <span className="flow-tables-toggle">{showTables ? '▼' : '▶'}</span>
              <span>Database — {tablesData.reduce((s, td) => s + td.tables.length, 0)} tabelle</span>
              <span className="flow-tables-count">{totalDbRefs} colonne referenziate</span>
            </div>
            {showTables && (
              <div className="flow-tables-body">
                {tablesData.map(td => td.tables.map(t => (
                  <div key={`${td.filePath}-${t.name}`} className="flow-tcard">
                    <div className="flow-tcard-name">
                      <span>{t.name}</span>
                      <span className="flow-tcard-file">{td.filePath.split('/').pop()}</span>
                    </div>
                    <div className="flow-tcard-cols">
                      {t.columns.slice(0, 15).map(c => (
                        <span key={c.name} className="flow-tcol">
                          {c.ops.includes('SELECT') ? '🔍' : c.ops.includes('INSERT') ? '➕' : c.ops.includes('UPDATE') ? '✏️' : '🗑️'}
                          {' '}{c.name}
                        </span>
                      ))}
                      {t.columns.length > 15 && <span className="flow-tcol-more">+{t.columns.length - 15} altre</span>}
                    </div>
                  </div>
                )))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function extractColsSimple(context: string): string[] {
  const cols: string[] = []
  const sm = context.match(/SELECT\s+(.+?)\s+FROM/i)
  if (sm) sm[1].split(',').map(s => s.trim().replace(/[`'"\s]/g, '')).forEach(p => {
    const c = p.split(/\s+/).pop() || p
    if (c !== '*' && c && !c.includes('(') && !cols.includes(c)) cols.push(c)
  })
  const im = context.match(/INSERT\s+INTO\s+\w+\s*\(([^)]+)\)/i)
  if (im) im[1].split(',').map(s => s.trim().replace(/[`'"]/g, '')).forEach(c => { if (c && !cols.includes(c)) cols.push(c) })
  const sm2 = context.match(/SET\s+(\w+)\s*=/i)
  if (sm2) { const c = sm2[1].trim(); if (c && !cols.includes(c)) cols.push(c) }
  return cols
}
