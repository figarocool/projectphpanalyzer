import React, { useState, useCallback, useRef, useEffect } from 'react'
import type { ProjectAnalysis, FileInfo, AppState, FileCategory, GraphNode, GraphEdge, HistoryEntry, DbInfo } from './types'
import GraphView from './components/GraphView'
import ErDiagramView from './components/ErDiagramView'
import CleanupPanel from './components/CleanupPanel'
import FileTree from './components/FileTree'
import SidePanel from './components/SidePanel'

const API = window.electronAPI

function categorizeFile(path: string): FileCategory {
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

const CATEGORY_COLORS: Record<FileCategory, string> = {
  controller: '#4fc3f7',
  model: '#81c784',
  view: '#ffb74d',
  config: '#9575cd',
  migration: '#f06292',
  service: '#4dd0e1',
  repository: '#aed581',
  middleware: '#ff8a65',
  command: '#7986cb',
  event: '#ba68c8',
  job: '#4db6ac',
  mail: '#dce775',
  test: '#ffd54f',
  other: '#90a4ae',
}

function extractColumns(context: string): string[] {
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

function buildDbSubgraphData(analysis: ProjectAnalysis): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  const addedFiles = new Set<string>()
  const tableColumnMap = new Map<string, string[]>()

  for (const f of analysis.files) {
    for (const ref of f.dbReferences) {
      if (!tableColumnMap.has(ref.table)) tableColumnMap.set(ref.table, [])
      const cols = tableColumnMap.get(ref.table)!
      extractColumns(ref.context).forEach(c => { if (!cols.includes(c)) cols.push(c) })
    }
  }

  const tableRefCount = new Map<string, number>()
  for (const f of analysis.files) {
    for (const ref of f.dbReferences) {
      tableRefCount.set(ref.table, (tableRefCount.get(ref.table) || 0) + 1)
    }
  }

  const sortedTables = [...tableColumnMap.entries()]
    .sort((a, b) => (tableRefCount.get(b[0]) || 0) - (tableRefCount.get(a[0]) || 0))
    .slice(0, 50)

  for (const [table, cols] of sortedTables) {
    const colStr = cols.length > 6 ? cols.slice(0, 6).join(', ') + '…' : cols.join(', ')
    nodes.push({
      id: `table:${table}`, label: `${table}\n[${colStr}]`, type: 'table',
      category: 'other', size: 0, lines: 0, classes: [], dbTables: [table], path: '', fullPath: '',
    })
  }

  const tableSet = new Set(sortedTables.map(([t]) => t))
  for (const f of analysis.files) {
    const relevant = f.dbReferences.filter(r => tableSet.has(r.table))
    if (relevant.length === 0) continue
    if (!addedFiles.has(f.relativePath)) {
      nodes.push({
        id: f.relativePath, label: f.relativePath.split('/').pop() || f.relativePath,
        type: 'file', category: categorizeFile(f.relativePath),
        size: f.size, lines: f.lines, classes: f.classes.map(c => c.name),
        dbTables: [...new Set(f.dbReferences.map(d => d.table))], path: f.relativePath, fullPath: f.path,
      })
      addedFiles.add(f.relativePath)
    }
    const tablesForFile = [...new Set(relevant.map(r => r.table))]
    for (const table of tablesForFile) {
      const ops = [...new Set(relevant.filter(r => r.table === table).map(r => r.operation))]
      edges.push({
        id: `subdb-${f.relativePath}-${table}`, source: f.relativePath,
        target: `table:${table}`, label: ops.join(', '), type: 'db',
      })
    }
  }

  return { nodes, edges }
}

function buildGraphData(analysis: ProjectAnalysis, showDbTables: boolean): { nodes: GraphNode[], edges: GraphEdge[] } {
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  const addedNodes = new Set<string>()
  const fileMap = new Map<string, FileInfo>()
  const dirCount = new Map<string, number>()
  const TOP = 100
  const SEEN = new Set<string>()

  for (const f of analysis.files) fileMap.set(f.relativePath, f)

  const scored: { file: FileInfo; score: number }[] = []
  for (const f of analysis.files) {
    const s = f.classes.length * 10 + f.dependencies.length * 3 + f.dbReferences.length * 5
    if (s > 0) scored.push({ file: f, score: s })
  }
  scored.sort((a, b) => b.score - a.score)
  const topSet = new Set<string>()
  for (let i = 0; i < Math.min(TOP, scored.length); i++) {
    topSet.add(scored[i].file.relativePath)
  }

  for (const f of analysis.files) {
    if (topSet.has(f.relativePath)) continue
    const p = f.relativePath.split('/')
    const dir = p.length > 1 ? p.slice(0, -1).join('/') : '_root'
    dirCount.set(dir, (dirCount.get(dir) || 0) + 1)
  }

  for (const s of scored) {
    if (!topSet.has(s.file.relativePath)) continue
    const f = s.file
    nodes.push({
      id: f.relativePath,
      label: f.relativePath.split('/').pop() || f.relativePath,
      type: 'file',
      category: categorizeFile(f.relativePath),
      size: f.size,
      lines: f.lines,
      classes: f.classes.map(c => c.name),
      dbTables: [...new Set(f.dbReferences.map(d => d.table))],
      path: f.relativePath,
      fullPath: f.path,
    })
    addedNodes.add(f.relativePath)
  }

  for (const s of scored) {
    if (!topSet.has(s.file.relativePath)) continue
    for (const dep of s.file.dependencies) {
      if (dep.resolvedPath) {
        if (topSet.has(dep.resolvedPath)) {
          edges.push({
            id: `dep-${s.file.relativePath}-${dep.resolvedPath}-${dep.type}`,
            source: s.file.relativePath, target: dep.resolvedPath,
            label: dep.type, type: dep.type,
          })
        } else if (!SEEN.has(dep.resolvedPath)) {
          SEEN.add(dep.resolvedPath)
        }
      }
    }
  }

  for (const [dir, count] of dirCount) {
    if (count > 0) {
      const label = dir === '_root' ? '/' : dir.split('/').pop() || dir
      nodes.push({
        id: `dir:${dir}`, label: `${label} (${count})`, type: 'dir',
        category: 'other', size: count, lines: 0,
        classes: [], dbTables: [], path: dir, fullPath: '',
      })
    }
  }

  if (showDbTables) {
    const dbNodeId = '_database'
    nodes.push({
      id: dbNodeId, label: 'Database', type: 'database',
      category: 'other', size: 0, lines: 0,
      classes: [], dbTables: [], path: '', fullPath: '',
    })
    const fileTables = new Map<string, string[]>()
    for (const s of scored) {
      if (!topSet.has(s.file.relativePath)) continue
      for (const ref of s.file.dbReferences) {
        if (!fileTables.has(s.file.relativePath)) fileTables.set(s.file.relativePath, [])
        const arr = fileTables.get(s.file.relativePath)!
        if (!arr.includes(ref.table)) arr.push(ref.table)
      }
    }
    for (const [fpath, tables] of fileTables) {
      edges.push({
        id: `db-${fpath}`,
        source: fpath, target: dbNodeId,
        label: tables.join(', '), type: 'db',
      })
    }
  }

  const hidden = Math.max(0, scored.length - TOP)
  if (hidden > 0) {
    nodes.push({
      id: '_more', label: `+${hidden} file`, type: 'dir',
      category: 'other', size: 0, lines: 0,
      classes: [], dbTables: [], path: '', fullPath: '',
    })
  }

  return { nodes, edges }
}

export default function App() {
  const [state, setState] = useState<AppState>({
    projectPath: null,
    analysis: null,
    selectedFile: null,
    loading: false,
    error: null,
    filterType: 'all',
    searchQuery: '',
    layout: 'cose',
    showDbTables: true,
    showDirNodes: false,
  })

  const [graphData, setGraphData] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] }>({ nodes: [], edges: [] })
  const [version, setVersion] = useState('')
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [activeTab, setActiveTab] = useState<'graph' | 'er' | 'cleanup'>('graph')
  const [fileTreeSort, setFileTreeSort] = useState<'name' | 'size'>('name')
  const [graphSearch, setGraphSearch] = useState('')
  const [dbInfo, setDbInfo] = useState<DbInfo | null>(null)
  const [showDbSubgraph, setShowDbSubgraph] = useState(false)
  const [dbSubgraphData, setDbSubgraphData] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] }>({ nodes: [], edges: [] })
  const graphRef = useRef<any>(null)

  useEffect(() => {
    API.getVersion().then(setVersion).catch(() => setVersion('1.0.0'))
    API.historyList().then(setHistory).catch(() => {})
  }, [])

  const [manualPath, setManualPath] = useState('')

  const loadCachedAnalysis = useCallback(async (projectPath: string) => {
    try {
      setState(prev => ({ ...prev, projectPath, loading: true, error: null, selectedFile: null, analysis: null }))
      setGraphData({ nodes: [], edges: [] })
      const analysis = await API.loadCached(projectPath)
      if (analysis) {
        setState(prev => ({ ...prev, analysis, loading: false }))
      } else {
        await runAnalysis(projectPath)
      }
    } catch (err: any) {
      setState(prev => ({ ...prev, loading: false, error: err.message || 'Errore caricamento' }))
    }
  }, [])

  const handleHistoryDelete = useCallback(async (projectPath: string, e: React.MouseEvent) => {
    e.stopPropagation()
    await API.historyDelete(projectPath)
    setHistory(prev => prev.filter(h => h.projectPath !== projectPath))
  }, [])

  const openProject = useCallback(async () => {
    try {
      const projectPath = await API.openProject()
      if (!projectPath) return
      await runAnalysis(projectPath)
    } catch (err: any) {
      setState(prev => ({ ...prev, error: 'Errore dialogo: ' + (err.message || '') }))
    }
  }, [])

  const runAnalysis = useCallback(async (projectPath: string) => {
    if (!projectPath) return
    setState(prev => ({ ...prev, projectPath, loading: true, error: null, selectedFile: null, analysis: null }))
    setGraphData({ nodes: [], edges: [] })
    setDbInfo(null)

    try {
      console.log('runAnalysis: calling analyzeProject')
      const { resultFile, summary } = await API.analyzeProject(projectPath)
      console.log(`runAnalysis: analyzeProject done, resultFile=${resultFile}, files=${summary.totalFiles}`)
      const analysis = await API.readResult(resultFile)
      console.log(`runAnalysis: readResult done, files=${analysis.summary.totalFiles}`)
      setState(prev => ({ ...prev, analysis, loading: false, error: null }))
      console.log('runAnalysis: setState called with analysis')
      API.historyList().then(setHistory).catch(() => {})
    } catch (err: any) {
      console.log('runAnalysis: error', err.message)
      setState(prev => ({ ...prev, loading: false, error: err.message || 'Errore durante l\'analisi' }))
    }
  }, [])

  const handleManualPath = useCallback(() => {
    if (manualPath.trim()) {
      runAnalysis(manualPath.trim())
    }
  }, [manualPath, runAnalysis])

  useEffect(() => {
    if (state.analysis) {
      console.log(`buildGraphData start: ${state.analysis.files.length} files`)
      const data = buildGraphData(state.analysis, state.showDbTables)
      console.log(`buildGraphData done: ${data.nodes.length} nodes, ${data.edges.length} edges`)
      setGraphData(data)
      console.log('setGraphData called')
    }
  }, [state.analysis, state.showDbTables])

  const handleShowDbTables = useCallback(() => {
    if (!state.analysis || state.analysis.summary.totalDbReferences === 0) return
    const data = buildDbSubgraphData(state.analysis)
    setDbSubgraphData(data)
    setShowDbSubgraph(true)
  }, [state.analysis])

  const handleHideDbTables = useCallback(() => {
    setShowDbSubgraph(false)
  }, [])

  const handleFilesDeleted = useCallback((deletedPaths: string[]) => {
    setState(prev => {
      if (!prev.analysis) return prev
      const deletedSet = new Set(deletedPaths)
      const remaining = prev.analysis.files.filter(f => !deletedSet.has(f.relativePath))
      return {
        ...prev,
        analysis: {
          ...prev.analysis,
          files: remaining,
          summary: {
            ...prev.analysis.summary,
            totalFiles: remaining.length,
            totalLines: remaining.reduce((s, f) => s + f.lines, 0),
            totalDependencies: remaining.reduce((s, f) => s + f.dependencies.length, 0),
            totalDbReferences: remaining.reduce((s, f) => s + f.dbReferences.length, 0),
            totalClasses: remaining.reduce((s, f) => s + f.classes.length, 0),
            totalDirs: prev.analysis.summary.totalDirs,
          },
        },
      }
    })
  }, [])

  const handleNodeClick = useCallback((nodeId: string) => {
    if (!state.analysis) return
    if (nodeId === '_database') {
      const tableMap = new Map<string, { files: { path: string; operations: string[] }[] }>()
      for (const f of state.analysis.files) {
        for (const ref of f.dbReferences) {
          if (!tableMap.has(ref.table)) tableMap.set(ref.table, { files: [] })
          const entry = tableMap.get(ref.table)!
          let fe = entry.files.find(e => e.path === f.relativePath)
          if (!fe) { fe = { path: f.relativePath, operations: [] }; entry.files.push(fe) }
          if (!fe.operations.includes(ref.operation)) fe.operations.push(ref.operation)
        }
      }
      const dbInfo: DbInfo = {
        tables: [...tableMap.entries()].map(([name, info]) => ({ name, files: info.files }))
          .sort((a, b) => b.files.length - a.files.length),
      }
      setDbInfo(dbInfo)
      setState(prev => ({ ...prev, selectedFile: null }))
    } else {
      setDbInfo(null)
      const file = state.analysis.files.find(f => f.relativePath === nodeId)
      setState(prev => ({ ...prev, selectedFile: file || null }))
    }
  }, [state.analysis])

  const handleFileSelect = useCallback((relativePath: string) => {
    if (!state.analysis) return
    const file = state.analysis.files.find(f => f.relativePath === relativePath)
    setState(prev => ({ ...prev, selectedFile: file || null }))
    if (graphRef.current && graphRef.current.zoomToNode) {
      graphRef.current.zoomToNode(relativePath)
    }
  }, [state.analysis])

  const updateLayout = useCallback((layout: AppState['layout']) => {
    setState(prev => ({ ...prev, layout }))
  }, [])

  const setFilterType = useCallback((filterType: FileCategory | 'all') => {
    setState(prev => ({ ...prev, filterType }))
  }, [])

  const setSearchQuery = useCallback((query: string) => {
    setState(prev => ({ ...prev, searchQuery: query }))
  }, [])

  const filteredFiles = state.analysis?.files.filter(f => {
    if (state.filterType !== 'all' && categorizeFile(f.relativePath) !== state.filterType) return false
    if (state.searchQuery && !f.relativePath.toLowerCase().includes(state.searchQuery.toLowerCase())) return false
    return true
  }) || []

  return (
    <div className="app">
      <header className="toolbar">
        <div className="toolbar-left">
          <h1 className="app-title">
            <span className="app-icon">◈</span>
            PHP Project Analyzer
          </h1>
          <button className="btn btn-primary" onClick={openProject} disabled={state.loading}>
            {state.loading ? '⏳ Analisi in corso...' : '📂 Scegli Cartella'}
          </button>
          <input
            type="text"
            className="input"
            placeholder="Incolla percorso progetto..."
            value={manualPath}
            onChange={e => setManualPath(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleManualPath()}
            style={{ width: 200 }}
          />
          <button className="btn btn-small" onClick={handleManualPath} disabled={state.loading || !manualPath.trim()}>
            ▶ Analizza
          </button>
          {state.projectPath && (
            <>
              <span className="project-path" title={state.projectPath}>
                📁 {state.projectPath.split('/').pop() || state.projectPath}
              </span>
              <button className="btn btn-small" onClick={() => {
                setState(prev => ({ ...prev, projectPath: null, analysis: null, selectedFile: null, error: null }))
                setGraphData({ nodes: [], edges: [] })
                setDbInfo(null)
                setShowDbSubgraph(false)
                setActiveTab('graph')
              }} title="Chiudi progetto e torna alla home">
                ✕ Chiudi
              </button>
            </>
          )}
        </div>
        <div className="toolbar-right">
          {state.analysis && (
            <>
              <span className="stats-badge">{state.analysis.summary.totalFiles} file</span>
              <span className="stats-badge">{state.analysis.summary.totalClasses} classi</span>
              <span className="stats-badge">{state.analysis.summary.totalDependencies} dipendenze</span>
              {state.analysis.summary.totalDbReferences > 0 && (
                <span className="stats-badge db-badge">{state.analysis.summary.totalDbReferences} tabelle</span>
              )}
              <span className="stats-badge">{state.analysis.summary.totalLines} righe</span>
              <select
                className="select"
                value={state.layout}
                onChange={e => updateLayout(e.target.value as any)}
              >
                <option value="cose">Forzato (default)</option>
                <option value="breadthfirst">Albero</option>
                <option value="concentric">Concentrico</option>
              </select>
            </>
          )}
          <span className="version">{version}</span>
        </div>
      </header>

      {state.loading && (
        <div className="loading-overlay">
          <div className="loading-spinner" />
          <p>Analisi del progetto in corso...</p>
        </div>
      )}

      {state.error && (
        <div className="error-bar">
          <span>❌ {state.error}</span>
          <button className="btn btn-small" onClick={() => setState(p => ({ ...p, error: null }))}>×</button>
        </div>
      )}

      {!state.analysis && !state.loading && (
        <div className="welcome">
          <div className="welcome-content">
            <div className="welcome-icon">◈</div>
            <h2>PHP Project Analyzer</h2>
            <p className="welcome-desc">
              Visualizza le correlazioni tra file, classi e database del tuo progetto PHP.
              <br />
              Un'esperienza tipo "Google Maps" per il tuo codice.
            </p>
            <div className="manual-path-row">
              <input
                type="text"
                className="input manual-input"
                placeholder="Incolla il percorso del progetto qui..."
                value={manualPath}
                onChange={e => setManualPath(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleManualPath()}
              />
              <button className="btn btn-primary" onClick={handleManualPath} disabled={!manualPath.trim()}>
                ▶ Analizza
              </button>
            </div>
            {history.length > 0 && (
              <div className="recent-projects">
                <h3>Progetti recenti</h3>
                <div className="recent-list">
                  {history.map((entry, i) => (
                    <div
                      key={entry.projectPath + i}
                      className="recent-item"
                      onDoubleClick={() => loadCachedAnalysis(entry.projectPath)}
                      title={entry.projectPath}
                    >
                      <div className="recent-info">
                        <span className="recent-name">{entry.projectName}</span>
                        <span className="recent-meta">
                          {entry.summary.totalFiles} file · {entry.summary.totalClasses} classi · {new Date(entry.analyzedAt).toLocaleDateString()}
                        </span>
                      </div>
                      <button
                        className="recent-delete"
                        onClick={e => handleHistoryDelete(entry.projectPath, e)}
                        title="Rimuovi dalla cronologia"
                      >×</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="welcome-features">
              <div className="feature">
                <span className="feature-icon">🔗</span>
                <span>Correlazioni tra file con frecce direzionali</span>
              </div>
              <div className="feature">
                <span className="feature-icon">🗄️</span>
                <span>Collegamenti a database e tabelle</span>
              </div>
              <div className="feature">
                <span className="feature-icon">📐</span>
                <span>Dimensioni file e metriche del progetto</span>
              </div>
              <div className="feature">
                <span className="feature-icon">🔍</span>
                <span>Navigazione infinita con zoom e pan</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {state.analysis && (
        <div className="main-layout">
          <aside className="sidebar-left">
            <div className="sidebar-header">
              <h3>Esplora File</h3>
              <div className="filter-bar">
                <input
                  type="text"
                  className="input"
                  placeholder="Cerca file..."
                  value={state.searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />
                <select
                  className="select"
                  value={state.filterType}
                  onChange={e => setFilterType(e.target.value as any)}
                >
                  <option value="all">Tutti</option>
                  <option value="controller">Controller</option>
                  <option value="model">Model</option>
                  <option value="view">View</option>
                  <option value="config">Config</option>
                  <option value="migration">Migration</option>
                  <option value="service">Service</option>
                  <option value="repository">Repository</option>
                  <option value="middleware">Middleware</option>
                  <option value="command">Command</option>
                  <option value="test">Test</option>
                  <option value="other">Altro</option>
                </select>
              </div>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={state.showDirNodes}
                  onChange={e => setState(p => ({ ...p, showDirNodes: e.target.checked }))}
                />
                Cartelle
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={state.showDbTables}
                  onChange={e => setState(p => ({ ...p, showDbTables: e.target.checked }))}
                />
                Tabelle DB
              </label>
              <div className="sort-bar">
                <span className="sort-label">Ordina:</span>
                <button
                  className={`btn btn-small ${fileTreeSort === 'name' ? 'btn-active' : ''}`}
                  onClick={() => setFileTreeSort('name')}
                >
                  Nome
                </button>
                <button
                  className={`btn btn-small ${fileTreeSort === 'size' ? 'btn-active' : ''}`}
                  onClick={() => setFileTreeSort('size')}
                >
                  Dimensione
                </button>
              </div>
            </div>
            <FileTree
              files={filteredFiles}
              selectedFile={state.selectedFile?.relativePath || null}
              onFileSelect={handleFileSelect}
              sortBy={fileTreeSort}
            />
          </aside>

          <main className="graph-area">
            <div className="graph-tabs">
              <button
                className={`tab-btn ${activeTab === 'graph' ? 'active' : ''}`}
                onClick={() => setActiveTab('graph')}
              >
                📊 Grafica
              </button>
              <button
                className={`tab-btn ${activeTab === 'er' ? 'active' : ''}`}
                onClick={() => setActiveTab('er')}
              >
                🗄️ Diagramma ER
              </button>
              <button
                className={`tab-btn ${activeTab === 'cleanup' ? 'active' : ''}`}
                onClick={() => setActiveTab('cleanup')}
              >
                🧹 Pulizia
              </button>
              <div className="graph-search">
                <input
                  type="text"
                  className="input graph-search-input"
                  placeholder="Cerca nel grafico..."
                  value={graphSearch}
                  onChange={e => setGraphSearch(e.target.value)}
                />
              </div>
            </div>
            {activeTab === 'graph' ? (
              <GraphView
                ref={graphRef}
                nodes={showDbSubgraph ? dbSubgraphData.nodes : graphData.nodes}
                edges={showDbSubgraph ? dbSubgraphData.edges : graphData.edges}
                onNodeClick={handleNodeClick}
                layout={state.layout}
                selectedNode={state.selectedFile?.relativePath || null}
                categoryColors={CATEGORY_COLORS}
                searchQuery={graphSearch}
                showDbSubgraph={showDbSubgraph}
                onShowDbTables={handleShowDbTables}
                onHideDbTables={handleHideDbTables}
              />
            ) : activeTab === 'er' ? (
              <ErDiagramView
                analysis={state.analysis}
                searchQuery={graphSearch}
              />
            ) : (
              <CleanupPanel projectPath={state.projectPath || ''} onFilesDeleted={handleFilesDeleted} />
            )}
          </main>

          <aside className="sidebar-right">
            <SidePanel
              file={state.selectedFile}
              dbInfo={dbInfo}
              allFiles={state.analysis.files}
              onFileSelect={handleFileSelect}
              categoryColors={CATEGORY_COLORS}
            />
          </aside>
        </div>
      )}
    </div>
  )
}
