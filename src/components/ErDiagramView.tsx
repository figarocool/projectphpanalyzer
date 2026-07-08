import React, { useMemo, useRef, useEffect, useState } from 'react'
import type { ProjectAnalysis } from '../types'

interface ColumnInfo { name: string; operations: string[] }
interface TableSchema { name: string; columns: Map<string, ColumnInfo>; referencingFiles: Set<string> }
interface FileTableEdge { file: string; table: string; columns: string[] }

function extractCols(context: string): string[] {
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

export default function ErDiagramView({ analysis, searchQuery }: { analysis: ProjectAnalysis; searchQuery?: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [hoveredFile, setHoveredFile] = useState<string | null>(null)
  const [hoveredTable, setHoveredTable] = useState<string | null>(null)

  const { tables, edges } = useMemo(() => {
    const tm = new Map<string, TableSchema>()
    const fileColMap = new Map<string, Map<string, string[]>>()

    for (const f of analysis.files) {
      if (f.dbReferences.length === 0) continue
      const perTable = new Map<string, string[]>()
      for (const ref of f.dbReferences) {
        if (!perTable.has(ref.table)) perTable.set(ref.table, [])
        const cols = perTable.get(ref.table)!
        extractCols(ref.context).forEach(c => { if (!cols.includes(c)) cols.push(c) })
        if (!tm.has(ref.table)) tm.set(ref.table, { name: ref.table, columns: new Map(), referencingFiles: new Set() })
        const t = tm.get(ref.table)!
        t.referencingFiles.add(f.relativePath)
        extractCols(ref.context).forEach(col => {
          if (!t.columns.has(col)) t.columns.set(col, { name: col, operations: [] })
          if (!t.columns.get(col)!.operations.includes(ref.operation)) t.columns.get(col)!.operations.push(ref.operation)
        })
      }
      fileColMap.set(f.relativePath, perTable)
    }

    const edges: FileTableEdge[] = []
    for (const [fpath, tables] of fileColMap) {
      for (const [table, cols] of tables) {
        edges.push({ file: fpath, table, columns: cols })
      }
    }

    return {
      tables: [...tm.values()].sort((a, b) => b.referencingFiles.size - a.referencingFiles.size),
      edges,
    }
  }, [analysis])

  const { filePositions, tablePositions, contentW, contentH } = useMemo(() => {
    const fs = new Set<string>()
    edges.forEach(e => fs.add(e.file))
    const fa = [...fs].sort()
    const fpos = new Map<string, { x: number; y: number }>()
    fa.forEach((f, i) => fpos.set(f, { x: 40, y: 30 + i * 24 }))

    const tpos = new Map<string, { x: number; y: number }>()
    tables.forEach((t, i) => {
      const ca = [...t.columns.values()]
      tpos.set(t.name, { x: 320, y: 30 + i * (Math.max(46, 26 + ca.length * 20) + 30) })
    })

    const mfh = 30 + fa.length * 24 + 40
    const mth = tables.length > 0 ? 30 + tables.reduce((max, t) => {
      const p = tpos.get(t.name)!; const ca = [...t.columns.values()]
      return Math.max(max, p.y + 26 + ca.length * 20 + 40)
    }, 0) : 40
    return { filePositions: fpos, tablePositions: tpos, contentW: 780, contentH: Math.max(mfh, mth, 300) }
  }, [tables, edges])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const svg = svgRef.current
      if (!svg) return
      const vb = svg.viewBox.baseVal
      const f = e.deltaY > 0 ? 1.12 : 0.88
      const cx = vb.x + vb.width / 2, cy = vb.y + vb.height / 2
      vb.width = Math.max(200, vb.width * f); vb.height = Math.max(150, vb.height * f)
      vb.x = cx - vb.width / 2; vb.y = cy - vb.height / 2
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    let dragging = false
    let lastVb = { x: 0, y: 0, w: 0, h: 0 }
    let startX = 0, startY = 0

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return
      const r = svg.getBoundingClientRect()
      if (r.width < 1 || r.height < 1) return
      const vb = svg.viewBox.baseVal
      dragging = true
      lastVb = { x: vb.x, y: vb.y, w: vb.width, h: vb.height }
      startX = ((e.clientX - r.left) / r.width) * vb.width + vb.x
      startY = ((e.clientY - r.top) / r.height) * vb.height + vb.y
    }

    const onMouseMove = (e: MouseEvent) => {
      if (!dragging) return
      const r = svg.getBoundingClientRect()
      if (r.width < 1 || r.height < 1) return
      const vb = svg.viewBox.baseVal
      const mx = ((e.clientX - r.left) / r.width) * vb.width + vb.x
      const my = ((e.clientY - r.top) / r.height) * vb.height + vb.y
      vb.x += startX - mx; vb.y += startY - my
    }

    const onMouseUp = () => { dragging = false }

    const onDblClick = (e: MouseEvent) => {
      const r = svg.getBoundingClientRect()
      if (r.width < 1 || r.height < 1) return
      const vb = svg.viewBox.baseVal
      const mx = ((e.clientX - r.left) / r.width) * vb.width + vb.x
      const my = ((e.clientY - r.top) / r.height) * vb.height + vb.y
      const nw = vb.width * 0.5, nh = vb.height * 0.5
      vb.width = Math.max(200, nw); vb.height = Math.max(150, nh)
      vb.x = Math.max(0, mx - vb.width / 2); vb.y = Math.max(0, my - vb.height / 2)
    }

    svg.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    svg.addEventListener('dblclick', onDblClick)
    return () => {
      svg.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      svg.removeEventListener('dblclick', onDblClick)
    }
  }, [])

  const q = (searchQuery || '').toLowerCase().trim()

  if (tables.length === 0) return <div className="er-empty">Nessuna tabella trovata nel progetto</div>

  const edgeColsForFile = (file: string, table: string): string[] => {
    const e = edges.find(e => e.file === file && e.table === table)
    return e?.columns || []
  }

  return (
    <div ref={containerRef} className="er-container">
      <svg ref={svgRef} className="er-svg" viewBox={`0 0 ${Math.min(contentW, 1200)} ${Math.min(contentH, 800)}`}>
        {/* Edges: file → table with column labels */}
        {edges.map((e, i) => {
          const fp = filePositions.get(e.file)
          const tp = tablePositions.get(e.table)
          if (!fp || !tp) return null
          const match = q ? e.file.toLowerCase().includes(q) || e.table.toLowerCase().includes(q) : true
          const isHighlighted = hoveredFile === e.file || hoveredTable === e.table
          const mx = (fp.x + 160 + tp.x) / 2, my = (fp.y + 10 + tp.y + 12) / 2
          return (
            <g key={`ft-${i}`}>
              <line x1={fp.x + 160} y1={fp.y + 10} x2={tp.x} y2={tp.y + 12}
                stroke="#42a5f5" strokeWidth={isHighlighted ? 2 : (match ? 1 : 0.3)}
                strokeOpacity={isHighlighted ? 0.9 : (match ? 0.4 : 0.08)}
                strokeDasharray={isHighlighted ? 'none' : '3,3'}
              />
              {e.columns.length > 0 && (
                <text x={mx} y={my - 4} textAnchor="middle" fill="#64b5f6" fontSize={8}
                  stroke="#0f0f1a" strokeWidth={2} strokeLinejoin="round" paintOrder="stroke"
                  style={{ opacity: isHighlighted ? 1 : 0.5 }}
                >{e.columns.join(', ')}</text>
              )}
            </g>
          )
        })}

        {/* File nodes */}
        {[...filePositions.entries()].map(([f, p]) => {
          const match = q ? f.toLowerCase().includes(q) : true
          const isHovered = hoveredFile === f
          return (
            <g key={`f-${f}`}
              style={{ opacity: q ? (match ? 1 : 0.15) : 1, cursor: 'pointer' }}
              onMouseEnter={() => setHoveredFile(f)}
              onMouseLeave={() => setHoveredFile(null)}
            >
              <rect x={p.x} y={p.y} width={160} height={20} rx={3}
                fill={isHovered ? '#2a2a4a' : '#1e1e36'}
                stroke={isHovered ? '#4fc3f7' : '#2a2a4a'} strokeWidth={isHovered ? 2 : 1}
              />
              <text x={p.x + 6} y={p.y + 14} fill={isHovered ? '#e0e0e0' : '#a0a0b8'} fontSize={10}>{f.split('/').pop()}</text>
            </g>
          )
        })}

        {/* Table nodes */}
        {tables.map(t => {
          const p = tablePositions.get(t.name)
          if (!p) return null
          const ca = [...t.columns.values()]
          const match = q ? t.name.toLowerCase().includes(q) || ca.some(c => c.name.toLowerCase().includes(q)) : true
          return (
            <g key={t.name}
              style={{ opacity: q ? (match ? 1 : 0.15) : 1, cursor: 'pointer' }}
              onMouseEnter={() => setHoveredTable(t.name)}
              onMouseLeave={() => setHoveredTable(null)}
            >
              <rect x={p.x} y={p.y} width={360} height={Math.max(46, 26 + ca.length * 20)} rx={6}
                fill="#16213e" stroke={match && q ? '#ffeb3b' : '#2a2a4a'} strokeWidth={match && q ? 2 : 1} />
              <rect x={p.x} y={p.y} width={360} height={22} rx={6} fill="#0d47a1" />
              <rect x={p.x} y={p.y + 11} width={360} height={11} fill="#0d47a1" />
              <text x={p.x + 180} y={p.y + 15} textAnchor="middle" fill="#e0e0e0" fontSize={11} fontWeight="bold">{t.name}</text>
              <text x={p.x + 350} y={p.y + 15} textAnchor="end" fill="#90caf9" fontSize={9}>{t.referencingFiles.size} file</text>
              {ca.map((col, ci) => {
                const usedByHoveredFile = hoveredFile ? edgeColsForFile(hoveredFile, t.name).includes(col.name) : false
                return (
                  <g key={col.name}>
                    {ci === 0 && <line x1={p.x} y1={p.y + 22} x2={p.x + 360} y2={p.y + 22} stroke="#2a2a4a" strokeWidth={1} />}
                    <text x={p.x + 8} y={p.y + 36 + ci * 20}
                      fill={usedByHoveredFile ? '#4fc3f7' : '#a0a0b8'}
                      fontSize={10}
                      fontWeight={usedByHoveredFile ? 'bold' : 'normal'}
                    >
                      {col.operations.includes('SELECT') ? '🔍' : col.operations.includes('INSERT') ? '➕' : col.operations.includes('UPDATE') ? '✏️' : col.operations.includes('DELETE') ? '🗑️' : '  '}
                      {' '}{col.name}
                    </text>
                  </g>
                )
              })}
            </g>
          )
        })}
      </svg>
      <div className="er-legend">
        <span>🔍 SELECT</span><span>➕ INSERT</span><span>✏️ UPDATE</span><span>🗑️ DELETE</span>
        <span>·</span><span>Passa il mouse su file/tabella per evidenziare le colonne collegate</span>
      </div>
    </div>
  )
}
