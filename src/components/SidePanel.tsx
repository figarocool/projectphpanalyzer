import React from 'react'
import type { FileInfo, FileCategory, DbInfo } from '../types'

interface SidePanelProps {
  file: FileInfo | null
  dbInfo: DbInfo | null
  allFiles: FileInfo[]
  onFileSelect: (path: string) => void
  categoryColors: Record<FileCategory, string>
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function getFileCategory(path: string): FileCategory {
  const lower = path.toLowerCase()
  if (lower.includes('controller')) return 'controller'
  if (lower.includes('model')) return 'model'
  if (lower.includes('view') || lower.includes('template')) return 'view'
  if (lower.includes('config')) return 'config'
  if (lower.includes('migration') || lower.includes('schema')) return 'migration'
  if (lower.includes('service')) return 'service'
  if (lower.includes('repository')) return 'repository'
  if (lower.includes('middleware')) return 'middleware'
  if (lower.includes('command') || lower.includes('console')) return 'command'
  if (lower.includes('event')) return 'event'
  if (lower.includes('job') || lower.includes('queue')) return 'job'
  if (lower.includes('mail') || lower.includes('email')) return 'mail'
  if (lower.includes('test') || lower.includes('spec')) return 'test'
  return 'other'
}

export default function SidePanel({ file, dbInfo, allFiles, onFileSelect, categoryColors }: SidePanelProps) {
  if (dbInfo) {
    return (
      <div className="side-panel">
        <div className="panel-section">
          <h4>Database</h4>
          {dbInfo.tables.map(t => (
            <div key={t.name} className="db-table-section">
              <h5 className="db-table-title">🗄️ {t.name}</h5>
              <div className="db-table-files">
                {t.files.map(f => (
                  <div
                    key={f.path}
                    className="db-file-item"
                    onClick={() => onFileSelect(f.path)}
                    title={f.path}
                  >
                    <span className="db-file-icon">📄</span>
                    <span className="db-file-path">{f.path.split('/').pop()}</span>
                    <span className="db-file-ops">
                      {f.operations.map(op => (
                        <span key={op} className={`db-op db-op-${op}`}>{op}</span>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (!file) {
    return (
      <div className="side-panel">
        <div className="side-panel-empty">
          Seleziona un nodo nel grafo<br />
          o un file nell'albero per vedere<br />
          i dettagli
        </div>
      </div>
    )
  }

  const category = getFileCategory(file.relativePath)
  const color = categoryColors[category]

  const incomingDeps = allFiles.filter(f =>
    f.dependencies.some(d => d.resolvedPath === file.relativePath)
  )

  const outgoingDeps = file.dependencies.filter(d => d.resolvedPath)
  const dbRefs = file.dbReferences || []
  const classes = file.classes || []

  return (
    <div className="side-panel">
      <div className="panel-section">
        <h4>File</h4>
        <div className="panel-file-path">{file.relativePath}</div>
        <div className="panel-stat">
          <span>Dimensione</span>
          <span className="panel-stat-value">{formatBytes(file.size)}</span>
        </div>
        <div className="panel-stat">
          <span>Righe</span>
          <span className="panel-stat-value">{file.lines.toLocaleString()}</span>
        </div>
        <div className="panel-stat">
          <span>Categoria</span>
          <span className="panel-stat-value" style={{ color }}>
            {category}
          </span>
        </div>
      </div>

      {classes.length > 0 && (
        <div className="panel-section">
          <h4>Classi ({classes.length})</h4>
          {classes.map((cls, i) => (
            <div key={i} className="class-item">
              <div className="class-name">{cls.name}</div>
              {cls.namespace && (
                <div style={{ fontSize: 10, color: '#6c6c8a' }}>{cls.namespace}</div>
              )}
              {cls.methods.length > 0 && (
                <div className="class-methods">
                  {cls.methods.slice(0, 8).join(', ')}
                  {cls.methods.length > 8 ? ` +${cls.methods.length - 8}` : ''}
                </div>
              )}
              {cls.extends && (
                <div style={{ fontSize: 10, color: '#ffa726', marginTop: 2 }}>
                  extends {cls.extends}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {incomingDeps.length > 0 && (
        <div className="panel-section">
          <h4>Dipendenze entranti ({incomingDeps.length})</h4>
          {incomingDeps.slice(0, 20).map((f, i) => (
            <div
              key={i}
              className="dep-item"
              onClick={() => onFileSelect(f.relativePath)}
              title={f.relativePath}
            >
              ← {f.relativePath.split('/').pop()}
            </div>
          ))}
          {incomingDeps.length > 20 && (
            <div style={{ fontSize: 11, color: '#6c6c8a', padding: '4px 8px' }}>
              +{incomingDeps.length - 20} altre dipendenze
            </div>
          )}
        </div>
      )}

      {outgoingDeps.length > 0 && (
        <div className="panel-section">
          <h4>Dipendenze uscenti ({outgoingDeps.length})</h4>
          {outgoingDeps.slice(0, 20).map((dep, i) => (
            <div
              key={i}
              className="dep-item"
              onClick={() => dep.resolvedPath && onFileSelect(dep.resolvedPath)}
              title={dep.resolvedPath || dep.target}
            >
              <span className={`dep-type dep-type-${dep.type}`}>{dep.type}</span>
              {dep.resolvedPath
                ? dep.resolvedPath.split('/').pop()
                : dep.target.split('\\').pop() || dep.target
              }
            </div>
          ))}
          {outgoingDeps.length > 20 && (
            <div style={{ fontSize: 11, color: '#6c6c8a', padding: '4px 8px' }}>
              +{outgoingDeps.length - 20} altre dipendenze
            </div>
          )}
        </div>
      )}

      {dbRefs.length > 0 && (
        <div className="panel-section">
          <h4>Database / Tabelle ({dbRefs.length})</h4>
          {dbRefs.map((ref, i) => (
            <div key={i} className="db-item">
              <span className={`db-op db-op-${ref.operation}`}>{ref.operation}</span>
              <span style={{ fontWeight: 500, color: '#e0e0e0' }}>{ref.table}</span>
              {ref.context && (
                <div style={{ fontSize: 10, color: '#6c6c8a', marginTop: 2, fontFamily: 'monospace' }}>
                  {ref.context.substring(0, 60)}{ref.context.length > 60 ? '...' : ''}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {classes.length === 0 && incomingDeps.length === 0 && outgoingDeps.length === 0 && dbRefs.length === 0 && (
        <div className="panel-section">
          <p style={{ color: '#6c6c8a', fontSize: 12 }}>
            Nessuna informazione aggiuntiva disponibile per questo file.
          </p>
        </div>
      )}
    </div>
  )
}
