const { app, BrowserWindow, ipcMain, dialog, screen } = require('electron')
const path = require('path')
const { spawn } = require('child_process')
const fs = require('fs')
const crypto = require('crypto')

let mainWindow = null

function createWindow() {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize
  const winW = Math.min(1400, sw)
  const winH = Math.min(900, sh - 40)

  mainWindow = new BrowserWindow({
    width: winW,
    height: winH,
    minWidth: Math.min(1000, sw),
    minHeight: Math.min(700, sh - 40),
    title: 'PHP Project Analyzer',
    backgroundColor: '#1a1a2e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })



  if (process.env.NODE_ENV === 'development' || process.argv.includes('--dev')) {
    mainWindow.loadURL('http://localhost:5173')
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  mainWindow.on('close', () => {
    app.quit()
  })
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

ipcMain.handle('dialog:openProject', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Seleziona il progetto PHP da analizzare',
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  } catch (err) {
    require('fs').appendFileSync('/tmp/electron-analyzer.log', `DIALOG ERROR: ${err.message}\n`)
    return null
  }
})

ipcMain.handle('analyze:direct', async (_event, projectPath) => {
  const logFile = '/tmp/electron-analyzer.log'
  const log = (msg) => require('fs').appendFileSync(logFile, new Date().toISOString() + ' ' + msg + '\n')
  log(`Direct analyze: ${projectPath}`)
  return projectPath
})

ipcMain.handle('analyze:project', async (event, projectPath) => {
  const analyzerScript = path.join(__dirname, '..', 'analyzer', 'bin', 'analyze')
  const resultFile = '/tmp/php-analyzer-result.json'
  const lightFile = '/tmp/php-analyzer-light.json'
  const logFile = '/tmp/electron-analyzer.log'
  const log = (msg) => require('fs').appendFileSync(logFile, new Date().toISOString() + ' ' + msg + '\n')

  log(`Starting analysis of: ${projectPath}`)
  log(`PHP script: ${analyzerScript}`)

  try { require('fs').unlinkSync(resultFile) } catch (e) {}
  try { require('fs').unlinkSync(lightFile) } catch (e) {}

  const { spawn } = require('child_process')
  const php = spawn('php', [analyzerScript, projectPath], {
    cwd: path.join(__dirname, '..', 'analyzer'),
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  php.stdout.on('data', (data) => {
    log(`PHP stdout: ${data.toString().trim()}`)
  })

  let stderr = ''
  php.stderr.on('data', (data) => {
    const msg = data.toString()
    stderr += msg
    const trimmed = msg.trim()
    if (trimmed.startsWith('PROGRESS:')) {
      const pct = parseInt(trimmed.slice(9), 10)
      if (!isNaN(pct) && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('analysis:progress', pct)
      }
    } else {
      log(`PHP STDERR: ${trimmed}`)
    }
  })

  php.on('error', (err) => {
    log(`SPAWN ERROR: ${err.message}`)
  })

  let resolved = false
  const waitForExit = new Promise((resolve) => {
    php.on('close', (code) => { if (!resolved) { resolved = true; resolve(code) } })
    php.on('exit', (code) => { if (!resolved) { resolved = true; resolve(code) } })
  })

  const waitForFile = async () => {
    const deadline = Date.now() + 600000
    while (Date.now() < deadline) {
      if (require('fs').existsSync(resultFile) || require('fs').existsSync(lightFile)) return true
      await new Promise(r => setTimeout(r, 1000))
    }
    return false
  }

  const code = await waitForExit
  log(`PHP exited with code ${code}`)

  const hasFile = await waitForFile()
  if (!hasFile && stderr) {
    throw new Error(`Errore PHP: ${stderr}`)
  }
  if (!hasFile) {
    throw new Error(`Processo terminato (codice ${code}) ma file risultato non trovato`)
  }

  const targetFile = require('fs').existsSync(lightFile) ? lightFile : resultFile
  const raw = require('fs').readFileSync(targetFile, 'utf-8')
  const result = JSON.parse(raw)
  log(`SUCCESS: ${result.summary.totalFiles} files, ${result.summary.totalClasses} classes, ${raw.length} bytes from ${targetFile}`)
  // Don't delete the file — renderer will read it directly via another IPC call
  // Return only summary to avoid large IPC payload
  return { resultFile: targetFile, summary: result.summary }
})

const layoutBinary = path.join(__dirname, '..', 'layout', 'layout')

ipcMain.handle('layout:compute', async (_event, graphData) => {
  const jsonInput = JSON.stringify(graphData)
  const logFile = '/tmp/electron-analyzer.log'
  const log = (msg) => require('fs').appendFileSync(logFile, new Date().toISOString() + ' ' + msg + '\n')
  log(`layout:compute start, ${graphData.nodes.length} nodes, ${graphData.edges.length} edges`)

  return new Promise((resolve, reject) => {
    const { spawn } = require('child_process')
    const proc = spawn(layoutBinary, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data) => { stdout += data.toString() })
    proc.stderr.on('data', (data) => { stderr += data.toString() })

    proc.on('close', (code) => {
      if (code !== 0) {
        log(`layout:compute error code=${code}: ${stderr.trim()}`)
        reject(new Error(`Layout error: ${stderr.trim()}`))
        return
      }
      try {
        const result = JSON.parse(stdout)
        log(`layout:compute done, ${Object.keys(result.positions).length} positions`)
        resolve(result)
      } catch (e) {
        log(`layout:compute parse error: ${e.message}, stdout=${stdout.slice(0, 200)}`)
        reject(e)
      }
    })

    proc.on('error', (err) => {
      log(`layout:compute spawn error: ${err.message}`)
      reject(err)
    })

    proc.stdin.write(jsonInput)
    proc.stdin.end()
  })
})

function storageDir() {
  const d = path.join(app.getPath('userData'), 'projects')
  if (!require('fs').existsSync(d)) require('fs').mkdirSync(d, { recursive: true })
  return d
}

function historyFile() {
  const d = path.join(app.getPath('userData'), 'projects')
  if (!require('fs').existsSync(d)) require('fs').mkdirSync(d, { recursive: true })
  return path.join(d, 'history.json')
}

function loadHistory() {
  try { return JSON.parse(require('fs').readFileSync(historyFile(), 'utf-8')) }
  catch (e) { return [] }
}

function saveHistory(entry) {
  const h = loadHistory().filter(e => e.projectPath !== entry.projectPath)
  h.unshift(entry)
  if (h.length > 20) h.length = 20
  require('fs').writeFileSync(historyFile(), JSON.stringify(h, null, 2))
}

function projectHash(projectPath) {
  return crypto.createHash('md5').update(projectPath).digest('hex')
}

function cachedAnalysisPath(projectPath) {
  return path.join(storageDir(), projectHash(projectPath) + '.json')
}

ipcMain.handle('app:getVersion', () => {
  return require('../package.json').version
})

ipcMain.handle('analyze:readResult', async (_event, resultFile) => {
  const raw = require('fs').readFileSync(resultFile, 'utf-8')
  const result = JSON.parse(raw)
  try { require('fs').unlinkSync(resultFile) } catch (e) {}
  try { require('fs').unlinkSync('/tmp/php-analyzer-result.json') } catch (e) {}
  try { require('fs').unlinkSync('/tmp/php-analyzer-light.json') } catch (e) {}
  // Cache persistently
  const cached = cachedAnalysisPath(result.projectPath)
  require('fs').writeFileSync(cached, JSON.stringify(result))
  // Update history
  saveHistory({
    projectPath: result.projectPath,
    projectName: result.projectName || result.projectPath.split('/').pop() || result.projectPath,
    analyzedAt: result.analyzedAt || new Date().toISOString(),
    summary: result.summary,
  })
  return result
})

ipcMain.handle('history:list', async () => {
  return loadHistory()
})

ipcMain.handle('history:loadCached', async (_event, projectPath) => {
  const cached = cachedAnalysisPath(projectPath)
  if (require('fs').existsSync(cached)) {
    const raw = require('fs').readFileSync(cached, 'utf-8')
    return JSON.parse(raw)
  }
  return null
})

ipcMain.handle('history:delete', async (_event, projectPath) => {
  const h = loadHistory().filter(e => e.projectPath !== projectPath)
  require('fs').writeFileSync(historyFile(), JSON.stringify(h, null, 2))
  const cached = cachedAnalysisPath(projectPath)
  try { require('fs').unlinkSync(cached) } catch (e) {}
  return true
})

// ── Database Audit ────────────────────────────────────────────

ipcMain.handle('database:audit', async (_event, projectPath) => {
  const logFile = '/tmp/electron-analyzer.log'
  const log = (msg) => require('fs').appendFileSync(logFile, new Date().toISOString() + ' ' + msg + '\n')
  log(`database:audit start ${projectPath}`)

  const script = path.join(__dirname, '..', 'analyzer', 'bin', 'analyze-db')
  return new Promise((resolve) => {
    const { spawn } = require('child_process')
    const php = spawn('php', [script, projectPath], {
      cwd: path.join(__dirname, '..', 'analyzer'),
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    php.stdout.on('data', (d) => { stdout += d.toString() })
    php.stderr.on('data', (d) => { stderr += d.toString() })
    php.on('close', (code) => {
      if (code !== 0) {
        log(`database:audit error code=${code}: ${stderr.trim()}`)
        resolve({ error: `Processo uscito con codice ${code}: ${stderr.trim()}` })
        return
      }
      try {
        const result = JSON.parse(stdout)
        log(`database:audit done ${result.tablesInDb.length} tables, ${result.orphanSqliteFiles.length} orphans`)
        resolve(result)
      } catch (e) {
        log(`database:audit parse error: ${e.message}`)
        resolve({ error: `Errore nel parsing del risultato: ${e.message}` })
      }
    })
    php.on('error', (err) => {
      log(`database:audit spawn error: ${err.message}`)
      resolve({ error: `Errore di avvio: ${err.message}` })
    })
  })
})

ipcMain.handle('db:cleanup', async (_event, projectPath, actions) => {
  const logFile = '/tmp/electron-analyzer.log'
  const log = (msg) => require('fs').appendFileSync(logFile, new Date().toISOString() + ' ' + msg + '\n')
  log(`db:cleanup start ${projectPath}`)

  const ts = Date.now()
  const hash = projectHash(projectPath)
  const backupFolder = path.join(backupDir(), hash, String(ts))
  require('fs').mkdirSync(backupFolder, { recursive: true })

  const manifest = { projectPath, createdAt: new Date().toISOString(), type: 'db-cleanup', files: [], sql: [] }
  const errors = []
  const executed = []

  // 1. Backup orphan SQLite files before deletion
  for (const relPath of (actions.deleteFiles || [])) {
    const src = path.join(projectPath, relPath)
    try {
      if (!require('fs').existsSync(src)) continue
      const relDir = path.dirname(relPath)
      const destDir = path.join(backupFolder, relDir)
      if (!require('fs').existsSync(destDir)) require('fs').mkdirSync(destDir, { recursive: true })
      require('fs').copyFileSync(src, path.join(backupFolder, relPath))
      manifest.files.push({ relativePath: relPath, action: 'delete' })
    } catch (e) {
      errors.push({ item: relPath, error: e.message })
    }
  }

  // 2. Back up main SQLite DB before modifications
  // Try to find the main DB file
  const sqliteCandidates = [
    path.join(projectPath, 'database', 'database.sqlite'),
    path.join(projectPath, 'data', 'database.sqlite'),
    path.join(projectPath, 'app.db'),
    path.join(projectPath, 'db.sqlite'),
  ]
  for (const sqlitePath of sqliteCandidates) {
    if (require('fs').existsSync(sqlitePath)) {
      const destDir = path.join(backupFolder, '_db_backup')
      if (!require('fs').existsSync(destDir)) require('fs').mkdirSync(destDir, { recursive: true })
      require('fs').copyFileSync(sqlitePath, path.join(destDir, path.basename(sqlitePath)))
      manifest.sql.push({ file: sqlitePath, action: 'backup' })
      break
    }
  }

  // 3. Execute SQL operations via PHP script
  if ((actions.dropTables && actions.dropTables.length > 0) || (actions.dropColumns && actions.dropColumns.length > 0)) {
    const script = path.join(__dirname, '..', 'analyzer', 'bin', 'cleanup-db')
    const input = JSON.stringify({ projectPath, actions: { dropTables: actions.dropTables || [], dropColumns: actions.dropColumns || [] } })

    await new Promise((resolve) => {
      const { spawn } = require('child_process')
      const php = spawn('php', [script], {
        cwd: path.join(__dirname, '..', 'analyzer'),
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      let stdout = ''
      let stderr = ''
      php.stdout.on('data', (d) => { stdout += d.toString() })
      php.stderr.on('data', (d) => { stderr += d.toString() })
      php.on('close', (code) => {
        try {
          const res = JSON.parse(stdout)
          if (res.executed) {
            for (const e of res.executed) {
              executed.push(e)
              manifest.sql.push({ sql: e, action: 'execute' })
            }
          }
          if (res.errors) {
            for (const e of res.errors) errors.push({ item: 'sql', error: e })
          }
        } catch (e) {
          errors.push({ item: 'php-output', error: stdout.slice(0, 500) })
        }
        resolve()
      })
      php.on('error', (err) => {
        errors.push({ item: 'php-spawn', error: err.message })
        resolve()
      })
      php.stdin.write(input)
      php.stdin.end()
    })
  }

  // 4. Delete orphan SQLite files
  for (const relPath of (actions.deleteFiles || [])) {
    const src = path.join(projectPath, relPath)
    try {
      if (require('fs').existsSync(src)) {
        require('fs').unlinkSync(src)
        log(`db:cleanup deleted file ${relPath}`)
      }
    } catch (e) {
      errors.push({ item: relPath, error: e.message })
    }
  }

  // 5. Write manifest
  require('fs').writeFileSync(path.join(backupFolder, 'manifest.json'), JSON.stringify(manifest, null, 2))

  log(`db:cleanup done executed=${executed.length} errors=${errors.length}`)
  return { executed, errors, backupId: `${hash}/${ts}` }
})

// ── Backup & Cleanup ──────────────────────────────────────────

function backupDir() {
  const d = path.join(app.getPath('userData'), 'backups')
  if (!require('fs').existsSync(d)) require('fs').mkdirSync(d, { recursive: true })
  return d
}

function md5File(filePath) {
  try {
    const content = require('fs').readFileSync(filePath)
    return crypto.createHash('md5').update(content).digest('hex')
  } catch (e) {
    return null
  }
}

function isTestFilePath(relativePath) {
  const parts = relativePath.split('/')
  // Check directory names
  for (const p of parts) {
    const lower = p.toLowerCase()
    if (lower === 'tests' || lower === 'test' || lower === 'spec' || lower === '__tests__' || lower === 'fixtures' || lower === 'mock' || lower === 'mocks') return true
  }
  // Check file names
  const name = parts[parts.length - 1].toLowerCase()
  return name.endsWith('test.php') || name.endsWith('teste.php') || name.endsWith('spec.php') ||
         name.endsWith('.bak') || name.endsWith('.orig') || name.endsWith('.copy') ||
         name.endsWith('-copy.php') || name.endsWith('_copy.php') ||
         name.startsWith('copy_') || name.startsWith('backup_') ||
         name.includes('-copy.') || name.includes('(copy)')
}

function isHiddenDir(entry) {
  return entry.name.startsWith('.') && entry.name !== '.'
}

ipcMain.handle('cleanup:scan', async (_event, projectPath) => {
  const logFile = '/tmp/electron-analyzer.log'
  const log = (msg) => require('fs').appendFileSync(logFile, new Date().toISOString() + ' ' + msg + '\n')
  log(`cleanup:scan start ${projectPath}`)

  const files = []
  const walkDir = (dir, relative) => {
    let entries
    try { entries = require('fs').readdirSync(dir, { withFileTypes: true }) }
    catch (e) { return }
    for (const entry of entries) {
      if (isHiddenDir(entry)) continue
      const full = path.join(dir, entry.name)
      const rel = relative ? path.join(relative, entry.name) : entry.name
      if (entry.isDirectory()) {
        walkDir(full, rel)
      } else if (entry.isFile()) {
        try {
          const stat = require('fs').statSync(full)
          files.push({ relativePath: rel, fullPath: full, size: stat.size, mtimeMs: stat.mtimeMs })
        } catch (e) {}
      }
    }
  }
  walkDir(projectPath, '')

  log(`cleanup:scan walked ${files.length} files`)

  // Find duplicates by MD5
  const hashMap = new Map()
  for (const f of files) {
    const hash = md5File(f.fullPath)
    if (hash) {
      if (!hashMap.has(hash)) hashMap.set(hash, [])
      hashMap.get(hash).push(f)
    }
  }

  const duplicates = []
  for (const [hash, dupFiles] of hashMap) {
    if (dupFiles.length > 1) {
      // Keep the first one (alphabetically) as original, rest are duplicates
      dupFiles.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
      for (let i = 1; i < dupFiles.length; i++) {
        duplicates.push({ ...dupFiles[i], reason: 'duplicate', originalPath: dupFiles[0].relativePath })
      }
    }
  }

  // Find test files
  const testFiles = files
    .filter(f => isTestFilePath(f.relativePath))
    .map(f => ({ ...f, reason: 'test', originalPath: null }))

  // Find very small files (less than 10 bytes) — likely artifacts
  const artifacts = files
    .filter(f => f.size > 0 && f.size < 10 && !f.relativePath.endsWith('.gitignore') && !f.relativePath.endsWith('.env'))
    .map(f => ({ ...f, reason: 'artifact', originalPath: null }))

  const all = [...duplicates, ...testFiles, ...artifacts]
  log(`cleanup:scan found ${duplicates.length} duplicates, ${testFiles.length} test, ${artifacts.length} artifacts`)

  return {
    duplicates: duplicates.map(f => ({ relativePath: f.relativePath, size: f.size, reason: f.reason, originalPath: f.originalPath })),
    testFiles: testFiles.map(f => ({ relativePath: f.relativePath, size: f.size, reason: f.reason, originalPath: null })),
    artifacts: artifacts.map(f => ({ relativePath: f.relativePath, size: f.size, reason: f.reason, originalPath: null })),
  }
})

ipcMain.handle('cleanup:backupAndDelete', async (_event, projectPath, filesToDelete) => {
  const logFile = '/tmp/electron-analyzer.log'
  const log = (msg) => require('fs').appendFileSync(logFile, new Date().toISOString() + ' ' + msg + '\n')
  log(`cleanup:backupAndDelete ${filesToDelete.length} files`)

  const ts = Date.now()
  const hash = projectHash(projectPath)
  const backupFolder = path.join(backupDir(), hash, String(ts))
  require('fs').mkdirSync(backupFolder, { recursive: true })

  const manifest = { projectPath, createdAt: new Date().toISOString(), files: [] }
  const errors = []
  const deleted = []

  for (const f of filesToDelete) {
    const src = f.fullPath || path.join(projectPath, f.relativePath)
    try {
      if (!require('fs').existsSync(src)) {
        log(`cleanup:skip not found ${src}`)
        continue
      }
      // Backup
      const relDir = path.dirname(f.relativePath)
      const destDir = path.join(backupFolder, relDir)
      if (!require('fs').existsSync(destDir)) require('fs').mkdirSync(destDir, { recursive: true })
      const dest = path.join(backupFolder, f.relativePath)
      require('fs').copyFileSync(src, dest)
      // Delete
      require('fs').unlinkSync(src)
      manifest.files.push({ relativePath: f.relativePath, size: f.size, reason: f.reason || 'manual' })
      deleted.push(f.relativePath)
      log(`cleanup:deleted ${f.relativePath}`)
    } catch (e) {
      log(`cleanup:error ${f.relativePath}: ${e.message}`)
      errors.push({ file: f.relativePath, error: e.message })
    }
  }

  // Write manifest
  require('fs').writeFileSync(path.join(backupFolder, 'manifest.json'), JSON.stringify(manifest, null, 2))

  log(`cleanup:done deleted=${deleted.length} errors=${errors.length}`)
  return { deleted, errors, backupId: `${hash}/${ts}` }
})

ipcMain.handle('backup:list', async (_event, projectPath) => {
  const hash = projectHash(projectPath)
  const dir = path.join(backupDir(), hash)
  if (!require('fs').existsSync(dir)) return []
  const backups = []
  for (const ts of require('fs').readdirSync(dir)) {
    const manifestPath = path.join(dir, ts, 'manifest.json')
    if (require('fs').existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(require('fs').readFileSync(manifestPath, 'utf-8'))
        backups.push({
          backupId: `${hash}/${ts}`,
          createdAt: manifest.createdAt,
          fileCount: manifest.files.length,
          files: manifest.files,
        })
      } catch (e) {}
    }
  }
  return backups.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
})

ipcMain.handle('backup:restore', async (_event, backupId, filesToRestore) => {
  const logFile = '/tmp/electron-analyzer.log'
  const log = (msg) => require('fs').appendFileSync(logFile, new Date().toISOString() + ' ' + msg + '\n')
  log(`backup:restore ${backupId} ${filesToRestore.length} files`)

  const [hash, ts] = backupId.split('/')
  const backupFolder = path.join(backupDir(), hash, ts)
  const manifestPath = path.join(backupFolder, 'manifest.json')
  let manifest
  try { manifest = JSON.parse(require('fs').readFileSync(manifestPath, 'utf-8')) }
  catch (e) { return { restored: [], errors: [{ file: 'manifest', error: 'Backup non trovato' }] } }

  const restored = []
  const errors = []

  for (const f of manifest.files) {
    if (filesToRestore.length > 0 && !filesToRestore.includes(f.relativePath)) continue
    const src = path.join(backupFolder, f.relativePath)
    const dest = path.join(manifest.projectPath, f.relativePath)
    try {
      if (!require('fs').existsSync(src)) {
        errors.push({ file: f.relativePath, error: 'File di backup non trovato' })
        continue
      }
      const destDir = path.dirname(dest)
      if (!require('fs').existsSync(destDir)) require('fs').mkdirSync(destDir, { recursive: true })
      require('fs').copyFileSync(src, dest)
      restored.push(f.relativePath)
      log(`backup:restored ${f.relativePath}`)
    } catch (e) {
      errors.push({ file: f.relativePath, error: e.message })
      log(`backup:restore error ${f.relativePath}: ${e.message}`)
    }
  }

  return { restored, errors }
})

// ── File editor: read / save ──
ipcMain.handle('file:read', async (_event, filePath) => {
  try {
    const resolved = path.resolve(filePath)
    if (!require('fs').existsSync(resolved)) return { content: '', error: 'File non trovato' }
    const content = require('fs').readFileSync(resolved, 'utf-8')
    return { content }
  } catch (e) {
    return { content: '', error: e.message }
  }
})

ipcMain.handle('file:save', async (_event, filePath, content) => {
  try {
    const resolved = path.resolve(filePath)
    require('fs').writeFileSync(resolved, content, 'utf-8')
    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
})

// ── SQLite schema browser ──
ipcMain.handle('sqlite:schema', async (_event, dbPath) => {
  try {
    const resolved = path.resolve(dbPath)
    if (!require('fs').existsSync(resolved)) return { dbPath, tables: [], error: 'File DB non trovato' }
    // Use php script for SQLite schema
    const scriptPath = path.join(__dirname, '..', 'analyzer', 'bin', 'sqlite-schema.php')
    if (!require('fs').existsSync(scriptPath)) return { dbPath, tables: [], error: 'Script non trovato' }
    const result = await new Promise((resolve, reject) => {
      const proc = require('child_process').spawn('php', [scriptPath, resolved])
      let stdout = '', stderr = ''
      proc.stdout.on('data', d => stdout += d)
      proc.stderr.on('data', d => stderr += d)
      proc.on('close', (code) => {
        if (code !== 0) reject(new Error(stderr || 'Exit code ' + code))
        else try { resolve(JSON.parse(stdout)) } catch (e) { reject(new Error('JSON parse error: ' + stdout.slice(0, 200))) }
      })
      proc.on('error', reject)
    })
    return result
  } catch (e) {
    return { dbPath, tables: [], error: e.message }
  }
})
