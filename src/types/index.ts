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
  type: 'file' | 'dir' | 'table' | 'database'
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
    }
  }
}
