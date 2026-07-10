import React, { useEffect, useRef, useState, useCallback } from 'react'
import { EditorView } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { basicSetup } from '@codemirror/basic-setup'
import { php } from '@codemirror/lang-php'
import { oneDark } from '@codemirror/theme-one-dark'

const API = window.electronAPI

export default function FileEditor({
  filePath, fullPath, onClose,
}: {
  filePath: string; fullPath: string; onClose: () => void
}) {
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [content, setContent] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [readError, setReadError] = useState('')

  useEffect(() => {
    API.fileRead(fullPath).then((res) => {
      if (res.error) { setReadError(res.error); return }
      setContent(res.content)
      setLoaded(true)
    })
  }, [fullPath])

  useEffect(() => {
    if (!loaded || !editorRef.current) return
    if (viewRef.current) { viewRef.current.destroy(); viewRef.current = null }

    const updateListener = EditorView.updateListener.of((update: any) => {
      if (update.docChanged) setDirty(true)
    })

    const state = EditorState.create({
      doc: content,
      extensions: [basicSetup, php(), oneDark, EditorView.lineWrapping, updateListener],
    })

    const view = new EditorView({ state, parent: editorRef.current })
    viewRef.current = view
    return () => { view.destroy(); viewRef.current = null }
  }, [loaded, content])

  const handleSave = useCallback(async () => {
    if (!viewRef.current || saving) return
    setSaving(true)
    setMsg('')
    const code = viewRef.current.state.doc.toString()
    const res = await API.fileSave(fullPath, code)
    if (res.success) {
      setDirty(false)
      setMsg('✅ Salvato')
    } else {
      setMsg('❌ ' + (res.error || 'Errore salvataggio'))
    }
    setSaving(false)
    setTimeout(() => setMsg(''), 2000)
  }, [fullPath, saving])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault()
      handleSave()
    }
  }, [handleSave])

  return (
    <div className="editor-overlay" onKeyDown={handleKeyDown} tabIndex={0}>
      <div className="editor-container">
        <div className="editor-toolbar">
          <span className="editor-title">{filePath}</span>
          <div className="editor-actions">
            {msg && <span className="editor-msg">{msg}</span>}
            {dirty && <span className="editor-dirty">Modificato</span>}
            <button className="btn btn-small btn-primary" onClick={handleSave} disabled={saving || !dirty}>
              {saving ? '⏳' : '💾 Salva'}
            </button>
            <button className="btn btn-small" onClick={onClose}>✕ Chiudi</button>
          </div>
        </div>
        <div className="editor-body" ref={editorRef}>
          {!loaded && !readError && <div className="editor-placeholder">Caricamento...</div>}
          {readError && <div className="editor-placeholder error">❌ {readError}</div>}
        </div>
      </div>
    </div>
  )
}
