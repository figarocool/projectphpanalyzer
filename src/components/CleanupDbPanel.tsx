import React, { useState, useMemo } from 'react'
import type { DbAuditResult } from '../types'

const API = window.electronAPI

interface Props {
  projectPath: string
  onOpenSqlite?: (dbPath: string) => void
}

export default function CleanupDbPanel({ projectPath, onOpenSqlite }: Props) {
  const [result, setResult] = useState<DbAuditResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [cleaning, setCleaning] = useState(false)
  const [cleanResult, setCleanResult] = useState<{ executed: string[]; errors: { item: string; error: string }[]; backupId: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const startAudit = async () => {
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await API.auditDatabase(projectPath)
      if (res.error) {
        setError(res.error)
      } else {
        setResult(res)
      }
    } catch (e: any) {
      setError(e.message || 'Errore sconosciuto')
    } finally {
      setLoading(false)
    }
  }

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => {
      alert(`Copiato: ${label}`)
    }).catch(() => {
      const ta = document.createElement('textarea')
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      alert(`Copiato: ${label}`)
    })
  }

  const handleCleanup = async () => {
    if (!result) return
    const dropTables = result.tablesUnused.map(t => t.table)
    const dropColumns = result.columnsUnused.map(c => ({ table: c.table, columns: c.columns }))
    const deleteFiles = result.orphanSqliteFiles.map(f => f.path)
    if (dropTables.length === 0 && dropColumns.length === 0 && deleteFiles.length === 0) return

    const msg = `Stai per eliminare:\n` +
      (dropTables.length > 0 ? `  - ${dropTables.length} tabelle\n` : '') +
      (dropColumns.length > 0 ? `  - ${dropColumns.length} colonne\n` : '') +
      (deleteFiles.length > 0 ? `  - ${deleteFiles.length} file database\n` : '') +
      `\nVerrà creato un backup prima di procedere. Continuare?`
    if (!confirm(msg)) return

    setCleaning(true)
    setCleanResult(null)
    setError(null)
    try {
      const res = await API.dbCleanup(projectPath, { dropTables, dropColumns, deleteFiles })
      setCleanResult(res)
    } catch (e: any) {
      setError(e.message || 'Errore pulizia')
    } finally {
      setCleaning(false)
    }
  }

  const unusedTablesText = useMemo(() => {
    if (!result) return ''
    return result.tablesUnused.map(t => {
      const db = t.dbName ? `[${t.dbName}] ` : ''
      return `${db}${t.table}\n  colonne: ${t.columns.join(', ')}`
    }).join('\n')
  }, [result])

  const unusedColumnsText = useMemo(() => {
    if (!result) return ''
    return result.columnsUnused.map(c => {
      const db = c.dbName ? `[${c.dbName}] ` : ''
      return `${db}${c.table}\n  colonne non usate: ${c.columns.join(', ')}  (referenziato da ${c.fileCount} file)`
    }).join('\n')
  }, [result])

  return (
    <div style={{ padding: 16, overflow: 'auto', height: '100%' }}>
      {!result && !loading && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, marginTop: 60 }}>
          <h2 style={{ color: '#e0e0e0', margin: 0 }}>Pulizia Database</h2>
          <p style={{ color: '#888', fontSize: 13, textAlign: 'center', maxWidth: 500 }}>
            Analizza il database del progetto e confronta lo schema con le
            referenze trovate nel codice per individuare tabelle, colonne e
            file database inutilizzati.
          </p>
          <button className="btn btn-primary" onClick={startAudit}>
            Avvia analisi database
          </button>
        </div>
      )}

      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, marginTop: 60 }}>
          <div className="loading-spinner" />
          <p style={{ color: '#aaa' }}>Analisi database in corso...</p>
        </div>
      )}

      {cleaning && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, marginTop: 60 }}>
          <div className="loading-spinner" />
          <p style={{ color: '#aaa' }}>Pulizia database in corso (backup + operazioni SQL)...</p>
        </div>
      )}

      {error && !loading && (
        <div style={{ marginTop: 20 }}>
          <div style={{ background: '#2a1a1a', border: '1px solid #5a2a2a', borderRadius: 6, padding: 16, marginBottom: 12 }}>
            <p style={{ color: '#f06292', margin: 0 }}>{error}</p>
          </div>
          <button className="btn btn-small" onClick={startAudit}>Riprova</button>
        </div>
      )}

      {result && !loading && !cleaning && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
            <h2 style={{ color: '#e0e0e0', margin: 0 }}>Risultati analisi DB</h2>
            <span style={{
              background: result.connectionOk ? '#1a3a2a' : '#3a2a1a',
              color: result.connectionOk ? '#81c784' : '#ffb74d',
              padding: '3px 10px', borderRadius: 12, fontSize: 12,
            }}>
              {result.dbType || '?'} · {result.connectionOk ? 'Connesso' : 'Non connesso'}
            </span>
            {result.dbName && (
              <span style={{ color: '#888', fontSize: 12 }}>{result.dbName}</span>
            )}
            <button className="btn btn-small" onClick={startAudit} style={{ marginLeft: 'auto' }}>
              Riesegui
            </button>
            {(result.tablesUnused.length > 0 || result.columnsUnused.length > 0 || result.orphanSqliteFiles.length > 0) && (
              <button className="btn btn-primary" onClick={handleCleanup} disabled={cleaning}
                style={{ background: '#5a2a2a', borderColor: '#8a3a3a' }}>
                {cleaning ? '⏳ Pulizia...' : '🗑️ Pulisci'}
              </button>
            )}
          </div>

          {result.connectionError && !result.connectionOk && (
            <div style={{ background: '#2a1a1a', border: '1px solid #5a2a2a', borderRadius: 6, padding: 12, marginBottom: 16 }}>
              <p style={{ color: '#f06292', margin: 0, fontSize: 13 }}>
                Errore di connessione: {result.connectionError}
              </p>
              <p style={{ color: '#888', fontSize: 12, margin: '8px 0 0' }}>
                L'analisi delle tabelle/colonne non possibile senza connessione.
                Verranno mostrati solo i file database orfani.
              </p>
            </div>
          )}

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
            <StatBox label="Tabelle nel DB" value={result.tablesInDb.length} color="#4fc3f7" />
            <StatBox label="Tabelle usate" value={result.tablesUsed.length} color="#81c784" />
            <StatBox label="Tabelle non usate" value={result.tablesUnused.length} color="#f06292"
              onClick={() => document.getElementById('section-unused-tables')?.scrollIntoView({ behavior: 'smooth' })}
            />
            <StatBox label="Colonne non usate" value={result.columnsUnused.length} color="#ffb74d"
              onClick={() => document.getElementById('section-unused-columns')?.scrollIntoView({ behavior: 'smooth' })}
            />
            <StatBox label="DB orfani" value={result.orphanSqliteFiles.length} color="#ce93d8"
              onClick={() => document.getElementById('section-orphan-dbs')?.scrollIntoView({ behavior: 'smooth' })}
            />
          </div>

          {result.tablesUnused.length > 0 && (
            <Section id="section-unused-tables" title="Tabelle non utilizzate dal codice" count={result.tablesUnused.length}
              onCopy={() => copyToClipboard(unusedTablesText, 'tabelle non usate')}
            >
              {result.tablesUnused.map(t => (
                <div key={t.table} style={{
                  background: '#1a1a2e', border: '1px solid #3a2a2a', borderRadius: 6, padding: 12, marginBottom: 8,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: '#f06292', fontWeight: 'bold', fontSize: 14 }}>
                      {t.dbName ? `[${t.dbName}] ` : ''}{t.table}
                    </span>
                    <span style={{ color: '#888', fontSize: 11 }}>{t.columns.length} colonne</span>
                  </div>
                  {t.columns.length > 0 && (
                    <div style={{ color: '#666', fontSize: 11, marginTop: 4 }}>
                      {t.columns.join(', ')}
                    </div>
                  )}
                </div>
              ))}
            </Section>
          )}

          {result.columnsUnused.length > 0 && (
            <Section id="section-unused-columns" title="Colonne non utilizzate" count={result.columnsUnused.length}
              onCopy={() => copyToClipboard(unusedColumnsText, 'colonne non usate')}
            >
              {result.columnsUnused.map(c => (
                <div key={c.table} style={{
                  background: '#1a1a2e', border: '1px solid #3a3a1a', borderRadius: 6, padding: 12, marginBottom: 8,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: '#ffb74d', fontWeight: 'bold', fontSize: 14 }}>
                      {c.dbName ? `[${c.dbName}] ` : ''}{c.table}
                    </span>
                    <span style={{ color: '#888', fontSize: 11 }}>{c.fileCount} file · {c.columns.length} colonne</span>
                  </div>
                  <div style={{ color: '#666', fontSize: 11, marginTop: 4 }}>
                    {c.columns.join(', ')}
                  </div>
                </div>
              ))}
            </Section>
          )}

          {result.orphanSqliteFiles.length > 0 && (
            <Section id="section-orphan-dbs" title="Database SQLite orfani" count={result.orphanSqliteFiles.length}>
              {result.orphanSqliteFiles.map(f => (
                <div key={f.path} style={{
                  background: '#1a1a2e', border: '1px solid #2a2a4a', borderRadius: 6, padding: 12, marginBottom: 8,
                  cursor: onOpenSqlite ? 'pointer' : undefined,
                }} onDoubleClick={() => {
                  const fullPath = projectPath + '/' + f.path
                  onOpenSqlite?.(fullPath)
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: '#ce93d8', fontSize: 13 }}>{f.path}</span>
                    <span style={{ color: '#888', fontSize: 11 }}>{formatSize(f.size)}</span>
                  </div>
                  {onOpenSqlite && <div style={{ fontSize: 10, color: '#6c6c8a', marginTop: 4 }}>Doppio click per esplorare</div>}
                </div>
              ))}
            </Section>
          )}

          {cleanResult && (
            <div style={{
              background: cleanResult.errors.length > 0 ? '#2a1a1a' : '#1a2a1a',
              border: cleanResult.errors.length > 0 ? '1px solid #5a2a2a' : '1px solid #2a4a2a',
              borderRadius: 6, padding: 16, marginBottom: 16,
            }}>
              <h3 style={{ color: cleanResult.errors.length > 0 ? '#f06292' : '#81c784', margin: '0 0 8px', fontSize: 14 }}>
                {cleanResult.errors.length > 0 ? '⚙️ Pulizia completata con errori' : '✅ Pulizia completata'}
              </h3>
              {cleanResult.executed.length > 0 && (
                <div style={{ color: '#888', fontSize: 12, marginBottom: cleanResult.errors.length > 0 ? 8 : 0 }}>
                  <div style={{ color: '#81c784', marginBottom: 4 }}>Eseguito ({cleanResult.executed.length}):</div>
                  {cleanResult.executed.slice(0, 20).map((e, i) => (
                    <div key={i} style={{ marginLeft: 12 }}>• {e}</div>
                  ))}
                  {cleanResult.executed.length > 20 && (
                    <div style={{ marginLeft: 12, color: '#666' }}>... e altri {cleanResult.executed.length - 20}</div>
                  )}
                </div>
              )}
              {cleanResult.errors.length > 0 && (
                <div style={{ color: '#f06292', fontSize: 12 }}>
                  <div style={{ marginBottom: 4 }}>Errori ({cleanResult.errors.length}):</div>
                  {cleanResult.errors.map((e, i) => (
                    <div key={i} style={{ marginLeft: 12 }}>• {e.item}: {e.error}</div>
                  ))}
                </div>
              )}
              <div style={{ marginTop: 8, fontSize: 11, color: '#6c6c8a' }}>
                Backup ID: #{cleanResult.backupId.split('/')[1]} — Puoi ripristinare dalla scheda Backup
              </div>
            </div>
          )}

          {result.tablesUnused.length === 0 && result.columnsUnused.length === 0 && result.orphanSqliteFiles.length === 0 && (
            <div style={{
              background: '#1a2a1a', border: '1px solid #2a4a2a', borderRadius: 6, padding: 24, textAlign: 'center',
            }}>
              <p style={{ color: '#81c784', margin: 0 }}>Nessun problema trovato. Tutte le tabelle, colonne e file database sono utilizzati dal codice.</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function StatBox({ label, value, color, onClick }: { label: string; value: number; color: string; onClick?: () => void }) {
  return (
    <div onClick={onClick} style={{
      cursor: onClick ? 'pointer' : 'default',
      background: '#1a1a2e', border: '1px solid #2a2a4a', borderRadius: 8, padding: '12px 16px', minWidth: 120,
      textAlign: 'center',
    }}>
      <div style={{ color, fontSize: 24, fontWeight: 'bold' }}>{value}</div>
      <div style={{ color: '#888', fontSize: 11, marginTop: 2 }}>{label}</div>
    </div>
  )
}

function Section({ id, title, count, children, onCopy }: { id?: string; title: string; count: number; children: React.ReactNode; onCopy?: () => void }) {
  return (
    <div id={id} style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <h3 style={{ color: '#e0e0e0', margin: 0, fontSize: 15 }}>
          {title} ({count})
        </h3>
        {onCopy && (
          <button className="btn btn-small" onClick={onCopy} title="Copia negli appunti" style={{ fontSize: 10 }}>
            📋 Copia
          </button>
        )}
      </div>
      {children}
    </div>
  )
}

function formatSize(bytes: number): string {
  if (bytes > 1048576) return (bytes / 1048576).toFixed(1) + ' MB'
  if (bytes > 1024) return (bytes / 1024).toFixed(0) + ' KB'
  return bytes + ' B'
}
