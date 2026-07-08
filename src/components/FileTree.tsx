import React, { useMemo } from 'react'
import type { FileInfo, FileCategory } from '../types'

interface FileTreeProps {
  files: FileInfo[]
  selectedFile: string | null
  onFileSelect: (path: string) => void
  sortBy?: 'name' | 'size'
}

function getCategoryIcon(category: string): string {
  const icons: Record<string, string> = {
    controller: 'C',
    model: 'M',
    view: 'V',
    config: '⚙',
    migration: '▶',
    service: 'S',
    repository: 'R',
    middleware: 'M',
    command: '⌘',
    event: 'E',
    job: 'J',
    mail: '✉',
    test: 'T',
    other: '📄',
  }
  return icons[category] || '📄'
}

interface TreeNode {
  name: string
  path: string
  type: 'file' | 'dir'
  file?: FileInfo
  children: Map<string, TreeNode>
}

function buildTree(files: FileInfo[]): TreeNode {
  const root: TreeNode = {
    name: '',
    path: '',
    type: 'dir',
    children: new Map(),
  }

  for (const file of files) {
    const parts = file.relativePath.split('/')
    let current = root

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const isLast = i === parts.length - 1
      const childPath = parts.slice(0, i + 1).join('/')

      if (!current.children.has(part)) {
        current.children.set(part, {
          name: part,
          path: childPath,
          type: isLast ? 'file' : 'dir',
          file: isLast ? file : undefined,
          children: new Map(),
        })
      }

      current = current.children.get(part)!
    }
  }

  return root
}

function sortTreeNodes(node: TreeNode, sortBy: 'name' | 'size'): void {
  const entries = Array.from(node.children.entries())
  entries.sort((a, b) => {
    if (a[1].type !== b[1].type) return a[1].type === 'dir' ? -1 : 1
    if (sortBy === 'size' && a[1].file && b[1].file) return b[1].file.size - a[1].file.size
    return a[0].localeCompare(b[0])
  })
  node.children = new Map(entries)
  for (const child of node.children.values()) {
    sortTreeNodes(child, sortBy)
  }
}

function TreeItem({
  node,
  depth,
  selectedFile,
  onFileSelect,
  sortBy,
}: {
  node: TreeNode
  depth: number
  selectedFile: string | null
  onFileSelect: (path: string) => void
  sortBy: 'name' | 'size'
}) {
  const [expanded, setExpanded] = React.useState(depth < 2)
  const hasChildren = node.children.size > 0

  const category = useMemo(() => {
    if (node.file) {
      const lower = node.file.relativePath.toLowerCase()
      if (lower.includes('controller')) return 'controller'
      if (lower.includes('model')) return 'model'
      if (lower.includes('view') || lower.includes('template')) return 'view'
      if (lower.includes('config')) return 'config'
    }
    return 'other'
  }, [node.file])

  if (node.type === 'file' && node.file) {
    const isSelected = node.file.relativePath === selectedFile
    return (
      <div
        className={`tree-item ${isSelected ? 'selected' : ''}`}
        style={{ paddingLeft: 12 + depth * 16 }}
        onClick={() => onFileSelect(node.file!.relativePath)}
        title={node.file.relativePath}
      >
        <span className="tree-icon">
          <span className="category-dot" style={{ background: getColorForFile(node.file.relativePath) }} />
        </span>
        <span className="tree-label">{node.file.relativePath.split('/').pop()}</span>
        <span className="tree-meta">{formatSize(node.file.size)}</span>
      </div>
    )
  }

  const sortedChildren = useMemo(() => {
    const entries = Array.from(node.children.entries())
    entries.sort((a, b) => {
      if (a[1].type !== b[1].type) return a[1].type === 'dir' ? -1 : 1
      if (sortBy === 'size' && a[1].file && b[1].file) return b[1].file.size - a[1].file.size
      return a[0].localeCompare(b[0])
    })
    return entries
  }, [node.children, sortBy])

  return (
    <div>
      {node.name && (
        <div
          className={`tree-item`}
          style={{ paddingLeft: 12 + depth * 16 }}
          onClick={() => setExpanded(!expanded)}
        >
          <span className="tree-icon">
            {expanded ? '📂' : '📁'}
          </span>
          <span className="tree-label">{node.name}</span>
          <span className="tree-meta">{hasChildren ? node.children.size : ''}</span>
        </div>
      )}
      {expanded && sortedChildren.map(([, child]) => (
        <TreeItem
          key={child.path}
          node={child}
          depth={node.name ? depth + 1 : depth}
          selectedFile={selectedFile}
          onFileSelect={onFileSelect}
          sortBy={sortBy}
        />
      ))}
    </div>
  )
}

function getColorForFile(path: string): string {
  const lower = path.toLowerCase()
  if (lower.includes('controller')) return '#4fc3f7'
  if (lower.includes('model')) return '#81c784'
  if (lower.includes('view') || lower.includes('template')) return '#ffb74d'
  if (lower.includes('config')) return '#9575cd'
  if (lower.includes('migration') || lower.includes('schema')) return '#f06292'
  if (lower.includes('service')) return '#4dd0e1'
  if (lower.includes('repository')) return '#aed581'
  if (lower.includes('middleware')) return '#ff8a65'
  if (lower.includes('test') || lower.includes('spec')) return '#ffd54f'
  return '#90a4ae'
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`
}

export default function FileTree({ files, selectedFile, onFileSelect, sortBy = 'name' }: FileTreeProps) {
  const tree = useMemo(() => {
    const t = buildTree(files)
    sortTreeNodes(t, sortBy)
    return t
  }, [files, sortBy])

  return (
    <div className="file-tree">
      <TreeItem
        node={tree}
        depth={0}
        selectedFile={selectedFile}
        onFileSelect={onFileSelect}
        sortBy={sortBy}
      />
    </div>
  )
}
