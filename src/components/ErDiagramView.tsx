import React, { useMemo, useState, useEffect } from 'react'
import type { ProjectAnalysis } from '../types'

interface ColumnInfo { name: string; operations: string[] }
interface TableSchema { name: string; columns: Map<string, ColumnInfo>; referencingFiles: Map<string, string[]> }

export default function ErDiagramView({
  analysis, searchQuery, onFileSelect,
}: {
  analysis: ProjectAnalysis; searchQuery?: string; onFileSelect?: (path: string) => void
}) {
  const [focusedFile, setFocusedFile] = useState<string | null>(null)
  const [q, setQ] = useState('')

  const { fileMap, tableMap } = useMemo(() => {
    const fm = new Map<string, string[]>()
    const tm = new Map<string, TableSchema>()
    for (const f of analysis.files) {
      if (f.dbReferences.length === 0) continue
      const tablesForFile = new Set<string>()
      for (const ref of f.dbReferences) {
        tablesForFile.add(ref.table)
        if (!tm.has(ref.table)) tm.set(ref.table, { name: ref.table, columns: new Map(), referencingFiles: new Map() })
        const t = tm.get(ref.table)!
        t.referencingFiles.set(f.relativePath, [])
        const cols = extractCols(ref.context)
        cols.forEach(col => {
          if (!t.columns.has(col)) t.columns.set(col, { name: col, operations: [] })
          if (!t.columns.get(col)!.operations.includes(ref.operation)) t.columns.get(col)!.operations.push(ref.operation)
        })
      }
      fm.set(f.relativePath, [...tablesForFile])
    }
    return { fileMap: fm, tableMap: tm }
  }, [analysis])

  const sortedFiles = useMemo(() => [...fileMap.keys()].sort(), [fileMap])

  useEffect(() => {
    if (!focusedFile && sortedFiles.length > 0) setFocusedFile(sortedFiles[0])
  }, [sortedFiles])

  const viewData = useMemo(() => {
    if (!focusedFile) return null
    const tables = fileMap.get(focusedFile) || []
    const withRefs = tables.map(t => {
      const ts = tableMap.get(t)
      if (!ts) return null
      const refs = [...ts.referencingFiles.keys()].filter(fp => fp !== focusedFile)
      return { ...ts, connectedFiles: refs }
    }).filter(Boolean) as (TableSchema & { connectedFiles: string[] })[]
    return { tables: withRefs }
  }, [focusedFile, fileMap, tableMap])

  const sq = q || searchQuery || ''
  const filteredTables = viewData?.tables.filter(t => {
    if (!sq) return true
    const lq = sq.toLowerCase()
    return t.name.toLowerCase().includes(lq) ||
      [...t.columns.values()].some(c => c.name.toLowerCase().includes(lq)) ||
      t.connectedFiles.some(fp => fp.toLowerCase().includes(lq))
  }) || []

  const handleNavigate = (fp: string) => setFocusedFile(fp)
  const handleOpenEditor = (fp: string) => onFileSelect?.(fp)

  return (
    <div className="er-container">
      <div className="er-topbar">
        <div className="er-file-nav">
          {sortedFiles.length > 0 && (
            <select value={focusedFile || ''} onChange={e => handleNavigate(e.target.value)} className="er-file-select">
              {sortedFiles.map(fp => (
                <option key={fp} value={fp}>{fp.split('/').pop()} — {fp}</option>
              ))}
            </select>
          )}
        </div>
        <input className="er-search" placeholder="Cerca tabella/colonna/file..." value={q}
          onChange={e => setQ(e.target.value)} />
      </div>

      {focusedFile && (
        <div className="er-file-header" onDoubleClick={() => handleOpenEditor(focusedFile)} title="Doppio click per aprire editor">
          <span className="er-file-icon">📄</span>
          <span className="er-file-path-text">{focusedFile}</span>
          <span className="er-file-tables-count">{viewData?.tables.length || 0} tabelle</span>
        </div>
      )}

      <div className="er-cards">
        {filteredTables.map(t => (
          <div key={t.name} className="er-card">
            <div className="er-card-header">
              <span className="er-card-table-icon">🗂️</span>
              <span className="er-card-table-name">{t.name}</span>
              <span className="er-card-meta">{t.columns.size} colonne · {t.referencingFiles.size} file</span>
            </div>
            <div className="er-card-columns">
              {[...t.columns.values()].map(col => (
                <div key={col.name} className="er-col">
                  <span className="er-col-op">
                    {col.operations.includes('SELECT') ? '🔍' :
                     col.operations.includes('INSERT') ? '➕' :
                     col.operations.includes('UPDATE') ? '✏️' : '🗑️'}
                  </span>
                  <span className="er-col-name">{col.name}</span>
                </div>
              ))}
            </div>
            {t.connectedFiles.length > 0 && (
              <div className="er-connected">
                <span className="er-conn-label">Referenziato da:</span>
                <div className="er-conn-files">
                  {t.connectedFiles.map(fp => (
                    <button key={fp} className="er-conn-file"
                      onClick={() => handleNavigate(fp)}
                      onDoubleClick={() => handleOpenEditor(fp)}
                      title={fp}
                    >
                      {fp.split('/').pop()}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
        {filteredTables.length === 0 && viewData && focusedFile && (
          <div className="er-empty">Nessuna tabella trovata per <strong>{focusedFile}</strong></div>
        )}
        {(!viewData || !focusedFile) && sortedFiles.length === 0 && (
          <div className="er-empty">Nessun file con riferimenti DB trovato</div>
        )}
      </div>

      <div className="er-legend">
        <span>🔍 SELECT</span><span>➕ INSERT</span><span>✏️ UPDATE</span><span>🗑️ DELETE</span>
        <span>·</span>
        <span>Click file connesso per navigare · Doppio click per aprire editor</span>
      </div>
    </div>
  )
}

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
