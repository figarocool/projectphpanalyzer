import React, { useState, useEffect, useCallback } from 'react'
import type { CleanupScanResult, CleanupFile, BackupEntry } from '../types'

const API = window.electronAPI

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

interface Props {
  projectPath: string
  onFilesDeleted?: (deletedPaths: string[]) => void
}

type Tab = 'scan' | 'backup'

const REASON_LABELS: Record<string, string> = {
  duplicate: 'Duplicato',
  test: 'Test',
  artifact: 'File minore',
}

export default function CleanupPanel({ projectPath, onFilesDeleted }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('scan')
  const [scanResult, setScanResult] = useState<CleanupScanResult | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [scanning, setScanning] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [result, setResult] = useState<{ deleted: string[]; errors: { file: string; error: string }[]; backupId: string } | null>(null)
  const [backups, setBackups] = useState<BackupEntry[]>([])
  const [restoring, setRestoring] = useState<string | null>(null)
  const [restoreResult, setRestoreResult] = useState<{ restored: string[]; errors: { file: string; error: string }[] } | null>(null)

  const runScan = useCallback(async () => {
    setScanning(true)
    setResult(null)
    try {
      const res = await API.cleanupScan(projectPath)
      setScanResult(res)
      setSelected(new Set())
    } catch (e: any) {
      console.error('Scan error:', e)
    }
    setScanning(false)
  }, [projectPath])

  const loadBackups = useCallback(async () => {
    try {
      const b = await API.backupList(projectPath)
      setBackups(b)
    } catch (e: any) {
      console.error('Backup list error:', e)
    }
  }, [projectPath])

  useEffect(() => { runScan(); loadBackups() }, [runScan, loadBackups])

  const allFiles = scanResult
    ? [...scanResult.duplicates, ...scanResult.testFiles, ...scanResult.artifacts]
    : []

  const toggleFile = (path: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path); else next.add(path)
      return next
    })
  }

  const toggleGroup = (files: CleanupFile[], checked: boolean) => {
    setSelected(prev => {
      const next = new Set(prev)
      files.forEach(f => { if (checked) next.add(f.relativePath); else next.delete(f.relativePath) })
      return next
    })
  }

  const handleDelete = async () => {
    if (selected.size === 0) return
    setDeleting(true)
    setResult(null)
    try {
      const filesToDelete = allFiles.filter(f => selected.has(f.relativePath))
      const res = await API.cleanupDelete(projectPath, filesToDelete)
      setResult(res)
      onFilesDeleted?.(res.deleted)
      await runScan()
      await loadBackups()
    } catch (e: any) {
      console.error('Delete error:', e)
    }
    setDeleting(false)
  }

  const handleRestore = async (backupId: string) => {
    setRestoring(backupId)
    setRestoreResult(null)
    try {
      const res = await API.backupRestore(backupId, [])
      setRestoreResult(res)
      if (res.errors.length === 0) setRestoring(null)
    } catch (e: any) {
      console.error('Restore error:', e)
    }
    setRestoring(null)
  }

  const groupTotal = (files: CleanupFile[]) => files.reduce((s, f) => s + f.size, 0)

  return (
    <div className="cleanup-panel">
      <div className="graph-tabs">
        <button className={`tab-btn ${activeTab === 'scan' ? 'active' : ''}`} onClick={() => setActiveTab('scan')}>
          🧹 Pulizia
        </button>
        <button className={`tab-btn ${activeTab === 'backup' ? 'active' : ''}`} onClick={() => { setActiveTab('backup'); loadBackups() }}>
          💾 Backup ({backups.length})
        </button>
      </div>

      {activeTab === 'scan' && (
        <div className="cleanup-scan">
          {result && (
            <div className="cleanup-result">
              <span>✅ Eliminati {result.deleted.length} file</span>
              {result.errors.length > 0 && (
                <span className="cleanup-errors"> ⚠️ {result.errors.length} errori</span>
              )}
              <span className="cleanup-backup-id">Backup: #{result.backupId.split('/')[1]}</span>
            </div>
          )}

          {restoreResult && (
            <div className="cleanup-result">
              <span>✅ Ripristinati {restoreResult.restored.length} file</span>
              {restoreResult.errors.length > 0 && (
                <span className="cleanup-errors"> ⚠️ {restoreResult.errors.length} errori</span>
              )}
            </div>
          )}

          {scanning && <div className="cleanup-scanning">Scansione in corso...</div>}

          {scanResult && !scanning && (
            <>
              <div className="cleanup-summary">
                Trovati {allFiles.length} file eliminabili
                {selected.size > 0 && (
                  <span> · {selected.size} selezionati ({formatBytes(
                    allFiles.filter(f => selected.has(f.relativePath)).reduce((s, f) => s + f.size, 0)
                  )})</span>
                )}
              </div>

              <div className="cleanup-actions-bar">
                <div className="cleanup-actions-left">
                  <button className="btn btn-small" onClick={() => setSelected(new Set(allFiles.map(f => f.relativePath)))} style={{ marginRight: 8 }}>
                    ✅ Seleziona tutto
                  </button>
                  <button className="btn btn-small" onClick={() => setSelected(new Set())} style={{ marginRight: 8 }}>
                    Deseleziona tutto
                  </button>
                  <button className="btn btn-small" onClick={runScan} disabled={scanning}>
                    🔄 Riscansiona
                  </button>
                </div>
                {selected.size > 0 ? (
                  <button className="btn btn-danger" onClick={handleDelete} disabled={deleting}>
                    {deleting ? '⏳ Backup ed eliminazione...' : `🗑️ Backup & Elimina ${selected.size} file`}
                  </button>
                ) : (
                  <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Seleziona i file da eliminare</span>
                )}
              </div>

              {scanResult.duplicates.length > 0 && (
                <div className="cleanup-group">
                  <label className="cleanup-group-header">
                    <input
                      type="checkbox"
                      checked={scanResult.duplicates.every(f => selected.has(f.relativePath))}
                      onChange={e => toggleGroup(scanResult.duplicates, e.target.checked)}
                    />
                    <span>Duplicati ({scanResult.duplicates.length} — {formatBytes(groupTotal(scanResult.duplicates))})</span>
                  </label>
                  {scanResult.duplicates.map(f => (
                    <label key={f.relativePath} className="cleanup-file">
                      <input type="checkbox" checked={selected.has(f.relativePath)} onChange={() => toggleFile(f.relativePath)} />
                      <span className="cleanup-file-path">{f.relativePath}</span>
                      <span className="cleanup-file-size">{formatBytes(f.size)}</span>
                      {f.originalPath && <span className="cleanup-file-orig">← {f.originalPath}</span>}
                    </label>
                  ))}
                </div>
              )}

              {scanResult.testFiles.length > 0 && (
                <div className="cleanup-group">
                  <label className="cleanup-group-header">
                    <input
                      type="checkbox"
                      checked={scanResult.testFiles.every(f => selected.has(f.relativePath))}
                      onChange={e => toggleGroup(scanResult.testFiles, e.target.checked)}
                    />
                    <span>File di test ({scanResult.testFiles.length} — {formatBytes(groupTotal(scanResult.testFiles))})</span>
                  </label>
                  {scanResult.testFiles.map(f => (
                    <label key={f.relativePath} className="cleanup-file">
                      <input type="checkbox" checked={selected.has(f.relativePath)} onChange={() => toggleFile(f.relativePath)} />
                      <span className="cleanup-file-path">{f.relativePath}</span>
                      <span className="cleanup-file-size">{formatBytes(f.size)}</span>
                    </label>
                  ))}
                </div>
              )}

              {scanResult.artifacts.length > 0 && (
                <div className="cleanup-group">
                  <label className="cleanup-group-header">
                    <input
                      type="checkbox"
                      checked={scanResult.artifacts.every(f => selected.has(f.relativePath))}
                      onChange={e => toggleGroup(scanResult.artifacts, e.target.checked)}
                    />
                    <span>File minori ({scanResult.artifacts.length} — {formatBytes(groupTotal(scanResult.artifacts))})</span>
                  </label>
                  {scanResult.artifacts.map(f => (
                    <label key={f.relativePath} className="cleanup-file">
                      <input type="checkbox" checked={selected.has(f.relativePath)} onChange={() => toggleFile(f.relativePath)} />
                      <span className="cleanup-file-path">{f.relativePath}</span>
                      <span className="cleanup-file-size">{formatBytes(f.size)}</span>
                    </label>
                  ))}
                </div>
              )}
            </>
          )}

          {!scanResult && !scanning && (
            <div className="cleanup-scanning">Nessun dato disponibile. Riavvia la scansione.</div>
          )}
        </div>
      )}

      {activeTab === 'backup' && (
        <div className="cleanup-backup">
          {backups.length === 0 && <div className="cleanup-scanning">Nessun backup disponibile</div>}
          {backups.map(b => (
            <div key={b.backupId} className="backup-card">
              <div className="backup-header">
                <span className="backup-date">{new Date(b.createdAt).toLocaleString()}</span>
                <span className="backup-count">{b.fileCount} file</span>
              </div>
              <div className="backup-files">
                {b.files.slice(0, 20).map(f => (
                  <div key={f.relativePath} className="backup-file-item">
                    <span className="cleanup-file-path">{f.relativePath}</span>
                    <span className={`reason-tag reason-${f.reason}`}>{REASON_LABELS[f.reason] || f.reason}</span>
                  </div>
                ))}
                {b.files.length > 20 && (
                  <div className="backup-file-item" style={{ color: 'var(--text-muted)' }}>
                    +{b.files.length - 20} file
                  </div>
                )}
              </div>
              <div className="backup-actions">
                <button className="btn btn-small" onClick={() => handleRestore(b.backupId)} disabled={restoring === b.backupId}>
                  {restoring === b.backupId ? '⏳ Ripristino...' : '↩️ Ripristina tutti'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
