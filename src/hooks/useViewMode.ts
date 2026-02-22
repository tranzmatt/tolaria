import { useState, useCallback, useEffect } from 'react'
import { isTauri } from '../mock-tauri'

export type ViewMode = 'editor-only' | 'editor-list' | 'all'

const STORAGE_KEY = 'laputa-view-mode'

function loadViewMode(): ViewMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'editor-only' || stored === 'editor-list' || stored === 'all') return stored
  } catch { /* ignore */ }
  return 'all'
}

export function useViewMode() {
  const [viewMode, setViewModeState] = useState<ViewMode>(loadViewMode)

  const setViewMode = useCallback((mode: ViewMode) => {
    setViewModeState(mode)
    try { localStorage.setItem(STORAGE_KEY, mode) } catch { /* ignore */ }
  }, [])

  const sidebarVisible = viewMode === 'all'
  const noteListVisible = viewMode === 'all' || viewMode === 'editor-list'

  // Listen for Tauri menu events
  useEffect(() => {
    if (!isTauri()) return

    let cleanup: (() => void) | undefined
    import('@tauri-apps/api/event').then(({ listen }) => {
      const unlisten = listen<string>('menu-event', (event) => {
        if (event.payload === 'view-editor-only') setViewMode('editor-only')
        else if (event.payload === 'view-editor-list') setViewMode('editor-list')
        else if (event.payload === 'view-all') setViewMode('all')
      })
      cleanup = () => { unlisten.then((fn) => fn()) }
    }).catch(() => { /* not in Tauri */ })

    return () => cleanup?.()
  }, [setViewMode])

  return { viewMode, setViewMode, sidebarVisible, noteListVisible }
}
