import React, { useEffect, useState } from 'react'
import type { SqliteSchemaResult } from '../types'

const API = window.electronAPI

export default function SqliteBrowser({
  dbPath, onClose,
}: {
  dbPath: string; onClose: () => void
}) {
  const [data, setData] = useState<SqliteSchemaResult | null>(null)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    API.sqliteSchema(dbPath).then((res) => {
      setData(res)
      if (res.error) setError(res.error)
      setLoading(false)
    }).catch((err) => {
      setError(err.message || 'Errore connessione')
      setLoading(false)
    })
  }, [dbPath])

  const toggleTable = (name: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  return (
    <div className="editor-overlay">
      <div className="editor-container" style={{ maxWidth: 800 }}>
        <div className="editor-toolbar">
          <span className="editor-title">🗄️ {dbPath.split('/').pop()}</span>
          <button className="btn btn-small" onClick={onClose}>✕ Chiudi</button>
        </div>
        <div className="sqlite-body" style={{ overflow: 'auto', padding: 12 }}>
          {loading && <div className="editor-placeholder">Caricamento schema...</div>}
          {error && <div className="editor-placeholder error">❌ {error}</div>}
          {data && !error && (
            <>
              <div className="sqlite-path">{dbPath}</div>
              <div className="sqlite-count">{data.tables.length} tabelle</div>
              {data.tables.map(t => (
                <div key={t.name} className="sqlite-table">
                  <div className="sqlite-table-header" onClick={() => toggleTable(t.name)}>
                    <span className="sqlite-expand">{expanded.has(t.name) ? '▼' : '▶'}</span>
                    <span className="sqlite-table-name">{t.name}</span>
                    <span className="sqlite-table-colcount">{t.columns.length} colonne</span>
                  </div>
                  {expanded.has(t.name) && (
                    <div className="sqlite-columns">
                      <div className="sqlite-col-row sqlite-col-header">
                        <span className="sqlite-col-name">Nome</span>
                        <span className="sqlite-col-type">Tipo</span>
                        <span className="sqlite-col-null">Nullable</span>
                        <span className="sqlite-col-pk">PK</span>
                        <span className="sqlite-col-default">Default</span>
                      </div>
                      {t.columns.map(c => (
                        <div key={c.name} className="sqlite-col-row">
                          <span className="sqlite-col-name">{c.name}</span>
                          <span className="sqlite-col-type">{c.type || '—'}</span>
                          <span className="sqlite-col-null">{c.nullable ? '✓' : ''}</span>
                          <span className="sqlite-col-pk">{c.pk ? '🔑' : ''}</span>
                          <span className="sqlite-col-default">{c.defaultValue || '—'}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
