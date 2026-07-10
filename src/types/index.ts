export interface ClassInfo {
  name: string
  namespace: string
  fullName: string
  type: 'class' | 'interface' | 'trait' | 'enum'
  methods: string[]
  properties: string[]
  extends: string | null
  implements: string[]
}

export interface Dependency {
  type: 'include' | 'require' | 'use'
  target: string
  resolvedPath: string | null
  line: number
}

export interface DbReference {
  table: string
  operation: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'UNKNOWN'
  context: string
  line: number
}

export interface FlowNode {
  id: number
  type: 'entry' | 'function' | 'method' | 'class' | 'if' | 'else' | 'elseif' | 'foreach' | 'for' | 'while' | 'switch' | 'case' | 'try' | 'catch' | 'return' | 'throw' | 'call' | 'include' | 'assign' | 'block'
  label: string
  line: number
}

export interface FlowEdge {
  source: number
  target: number
  label: string
}

export interface FlowGraph {
  nodes: FlowNode[]
  edges: FlowEdge[]
}

export interface FileInfo {
  path: string
  relativePath: string
  size: number
  lines: number
  isDir: boolean
  classes: ClassInfo[]
  traits: string[]
  interfaces: string[]
  functions: string[]
  dependencies: Dependency[]
  dbReferences: DbReference[]
  flowGraph: FlowGraph | null
}

export interface ProjectAnalysis {
  projectPath: string
  projectName: string
  analyzedAt: string
  summary: {
    totalFiles: number
    totalDirs: number
    totalLines: number
    totalClasses: number
    totalDependencies: number
    totalDbReferences: number
  }
  files: FileInfo[]
  dependencies: Dependency[]
  dbReferences: DbReference[]
}

export interface GraphNode {
  id: string
  label: string
  type: 'file' | 'dir' | 'table' | 'database' | 'module'
  category: FileCategory
  size: number
  lines: number
  classes: string[]
  dbTables: string[]
  path: string
  fullPath: string
}

export type FileCategory =
  | 'controller'
  | 'model'
  | 'view'
  | 'config'
  | 'migration'
  | 'service'
  | 'repository'
  | 'middleware'
  | 'command'
  | 'event'
  | 'job'
  | 'mail'
  | 'test'
  | 'other'

export interface GraphEdge {
  id: string
  source: string
  target: string
  label: string
  type: 'include' | 'require' | 'use' | 'db'
}

export interface HistoryEntry {
  projectPath: string
  projectName: string
  analyzedAt: string
  summary: ProjectAnalysis['summary']
}

export interface DbInfo {
  tables: { name: string; files: { path: string; operations: string[] }[] }[]
}

export interface AppState {
  projectPath: string | null
  analysis: ProjectAnalysis | null
  selectedFile: FileInfo | null
  loading: boolean
  error: string | null
  filterType: FileCategory | 'all'
  searchQuery: string
  layout: 'force-directed' | 'breadthfirst' | 'cose' | 'concentric'
  showDbTables: boolean
  showDirNodes: boolean
}

export interface CleanupFile {
  relativePath: string
  size: number
  reason: 'duplicate' | 'test' | 'artifact'
  originalPath: string | null
}

export interface CleanupScanResult {
  duplicates: CleanupFile[]
  testFiles: CleanupFile[]
  artifacts: CleanupFile[]
}

export interface BackupEntry {
  backupId: string
  createdAt: string
  fileCount: number
  files: { relativePath: string; size: number; reason: string }[]
}

export interface DbAuditResult {
  dbType: string | null
  dbName: string | null
  configFound: boolean
  connectionOk: boolean
  connectionError: string | null
  tablesInDb: string[]
  tablesUsed: string[]
  tablesUnused: { table: string; dbName: string | null; columns: string[] }[]
  columnsUnused: { table: string; dbName: string | null; columns: string[]; fileCount: number }[]
  orphanSqliteFiles: { path: string; size: number }[]
  error?: string
}

export interface SqliteSchemaResult {
  dbPath: string
  tables: { name: string; columns: { name: string; type: string; nullable: boolean; pk: boolean; defaultValue: string | null }[] }[]
  error?: string
}

declare global {
  interface Window {
    electronAPI: {
      openProject: () => Promise<string | null>
      analyzeProject: (path: string) => Promise<{ resultFile: string; summary: ProjectAnalysis['summary'] }>
      readResult: (resultFile: string) => Promise<ProjectAnalysis>
      getVersion: () => Promise<string>
      logToFile: (msg: string) => void
      historyList: () => Promise<HistoryEntry[]>
      loadCached: (projectPath: string) => Promise<ProjectAnalysis | null>
      historyDelete: (projectPath: string) => Promise<boolean>
      cleanupScan: (projectPath: string) => Promise<CleanupScanResult>
      cleanupDelete: (projectPath: string, files: CleanupFile[]) => Promise<{ deleted: string[]; errors: { file: string; error: string }[]; backupId: string }>
      backupList: (projectPath: string) => Promise<BackupEntry[]>
      backupRestore: (backupId: string, files: string[]) => Promise<{ restored: string[]; errors: { file: string; error: string }[] }>
      onProgress: (callback: (pct: number) => void) => void
      computeLayout: (graphData: { nodes: { id: string }[]; edges: { source: string; target: string }[] }) => Promise<{ positions: Record<string, { x: number; y: number }> }>
      auditDatabase: (projectPath: string) => Promise<DbAuditResult>
      dbCleanup: (projectPath: string, actions: { dropTables: string[]; dropColumns: { table: string; columns: string[] }[]; deleteFiles: string[] }) => Promise<{ executed: string[]; errors: { item: string; error: string }[]; backupId: string }>
      fileRead: (filePath: string) => Promise<{ content: string; error?: string }>
      fileSave: (filePath: string, content: string) => Promise<{ success: boolean; error?: string }>
      sqliteSchema: (dbPath: string) => Promise<SqliteSchemaResult>
    }
  }
}
