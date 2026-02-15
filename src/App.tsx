import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Sidebar } from './components/Sidebar'
import { NoteList } from './components/NoteList'
import { Editor } from './components/Editor'
import { Inspector, type FrontmatterValue } from './components/Inspector'
import { ResizeHandle } from './components/ResizeHandle'
import { CreateNoteDialog, type NoteType } from './components/CreateNoteDialog'
import { QuickOpenPalette } from './components/QuickOpenPalette'
import { Toast } from './components/Toast'
import { isTauri, mockInvoke, addMockEntry, updateMockContent } from './mock-tauri'
import type { VaultEntry, SidebarSelection, GitCommit } from './types'
import './App.css'

// TODO: Make vault path configurable via settings
const TEST_VAULT_PATH = '~/Laputa'

// Mock frontmatter update for browser testing
function updateMockFrontmatter(path: string, key: string, value: FrontmatterValue): string {
  // This is a simplified mock - in reality the Rust backend handles this
  const content = window.__mockContent?.[path] || ''
  
  // Format the key (quote if has spaces)
  const yamlKey = key.includes(' ') ? `"${key}"` : key
  
  // Format the value
  let yamlValue: string
  if (Array.isArray(value)) {
    yamlValue = '\n' + value.map(v => `  - "${v}"`).join('\n')
  } else if (typeof value === 'boolean') {
    yamlValue = value ? 'true' : 'false'
  } else if (value === null) {
    yamlValue = 'null'
  } else {
    yamlValue = String(value)
  }
  
  // Check if content has frontmatter
  if (!content.startsWith('---\n')) {
    // Add frontmatter
    return `---\n${yamlKey}: ${yamlValue}\n---\n${content}`
  }
  
  // Find frontmatter end
  const fmEnd = content.indexOf('\n---', 4)
  if (fmEnd === -1) return content
  
  const fm = content.slice(4, fmEnd)
  const rest = content.slice(fmEnd + 4)
  
  // Check if key exists
  const keyPattern = new RegExp(`^["']?${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']?\\s*:`, 'm')
  
  if (keyPattern.test(fm)) {
    // Replace existing key - need to handle multiline values
    const lines = fm.split('\n')
    const newLines: string[] = []
    let i = 0
    while (i < lines.length) {
      if (keyPattern.test(lines[i])) {
        // Skip this key and any list items
        i++
        while (i < lines.length && lines[i].startsWith('  - ')) {
          i++
        }
        // Add new value
        if (Array.isArray(value)) {
          newLines.push(`${yamlKey}:${yamlValue}`)
        } else {
          newLines.push(`${yamlKey}: ${yamlValue}`)
        }
        continue
      }
      newLines.push(lines[i])
      i++
    }
    return `---\n${newLines.join('\n')}\n---${rest}`
  } else {
    // Add new key
    if (Array.isArray(value)) {
      return `---\n${fm}\n${yamlKey}:${yamlValue}\n---${rest}`
    } else {
      return `---\n${fm}\n${yamlKey}: ${yamlValue}\n---${rest}`
    }
  }
}

function deleteMockFrontmatterProperty(path: string, key: string): string {
  const content = window.__mockContent?.[path] || ''
  
  if (!content.startsWith('---\n')) return content
  
  const fmEnd = content.indexOf('\n---', 4)
  if (fmEnd === -1) return content
  
  const fm = content.slice(4, fmEnd)
  const rest = content.slice(fmEnd + 4)
  
  const keyPattern = new RegExp(`^["']?${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']?\\s*:`, 'm')
  
  const lines = fm.split('\n')
  const newLines: string[] = []
  let i = 0
  while (i < lines.length) {
    if (keyPattern.test(lines[i])) {
      // Skip this key and any list items
      i++
      while (i < lines.length && lines[i].startsWith('  - ')) {
        i++
      }
      continue
    }
    newLines.push(lines[i])
    i++
  }
  
  return `---\n${newLines.join('\n')}\n---${rest}`
}

// Type declaration for mock content storage
declare global {
  interface Window {
    __mockContent?: Record<string, string>
  }
}

const DEFAULT_SELECTION: SidebarSelection = { kind: 'filter', filter: 'all' }

function App() {
  const [entries, setEntries] = useState<VaultEntry[]>([])
  const [selection, setSelection] = useState<SidebarSelection>(DEFAULT_SELECTION)
  const [tabs, setTabs] = useState<{ entry: VaultEntry; content: string }[]>([])
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null)
  const [sidebarWidth, setSidebarWidth] = useState(250)
  const [noteListWidth, setNoteListWidth] = useState(300)
  const [inspectorWidth, setInspectorWidth] = useState(280)
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false)
  const [allContent, setAllContent] = useState<Record<string, string>>({})
  const [gitHistory, setGitHistory] = useState<GitCommit[]>([])
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [showQuickOpen, setShowQuickOpen] = useState(false)
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  // Refs for keyboard shortcuts (to avoid stale closures)
  const activeTabPathRef = useRef(activeTabPath)
  activeTabPathRef.current = activeTabPath
  const handleCloseTabRef = useRef<(path: string) => void>(() => {})

  useEffect(() => {
    const loadVault = async () => {
      try {
        let result: VaultEntry[]
        if (isTauri()) {
          const path = TEST_VAULT_PATH.replace('~', '/Users/luca')
          result = await invoke<VaultEntry[]>('list_vault', { path })
        } else {
          // Running in browser (not Tauri) — use mock data for visual testing
          console.info('[mock] Using mock Tauri data for browser testing')
          result = await mockInvoke<VaultEntry[]>('list_vault', {})
        }
        console.log(`Vault scan complete: ${result.length} entries found`)
        setEntries(result)

        // Load all content for backlink scanning
        let content: Record<string, string>
        if (isTauri()) {
          // TODO: Add Tauri command for batch content loading
          content = {}
        } else {
          content = await mockInvoke<Record<string, string>>('get_all_content', {})
        }
        setAllContent(content)
      } catch (err) {
        console.warn('Vault scan failed:', err)
      }
    }
    loadVault()
  }, [])

  // Load git history when active tab changes
  useEffect(() => {
    if (!activeTabPath) {
      setGitHistory([])
      return
    }
    const loadHistory = async () => {
      try {
        let history: GitCommit[]
        if (isTauri()) {
          const vaultPath = TEST_VAULT_PATH.replace('~', '/Users/luca')
          history = await invoke<GitCommit[]>('get_file_history', { vaultPath, path: activeTabPath })
        } else {
          history = await mockInvoke<GitCommit[]>('get_file_history', { path: activeTabPath })
        }
        setGitHistory(history)
      } catch (err) {
        console.warn('Failed to load git history:', err)
        setGitHistory([])
      }
    }
    loadHistory()
  }, [activeTabPath])

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key === 'p') {
        e.preventDefault()
        setShowQuickOpen(true)
      } else if (mod && e.key === 'n') {
        e.preventDefault()
        setShowCreateDialog(true)
      } else if (mod && e.key === 's') {
        e.preventDefault()
        setToastMessage('Saved')
      } else if (mod && e.key === 'w') {
        e.preventDefault()
        const path = activeTabPathRef.current
        if (path) handleCloseTabRef.current(path)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const handleSelectNote = useCallback(async (entry: VaultEntry) => {
    // If tab already open, just switch to it
    setTabs((prev) => {
      if (prev.some((t) => t.entry.path === entry.path)) {
        setActiveTabPath(entry.path)
        return prev
      }
      return prev
    })

    // Check if we already have this tab (use functional check to avoid stale closure)
    let alreadyOpen = false
    setTabs((prev) => {
      alreadyOpen = prev.some((t) => t.entry.path === entry.path)
      return prev
    })
    if (alreadyOpen) return

    // Load content for new tab, then add and activate
    try {
      let content: string
      if (isTauri()) {
        content = await invoke<string>('get_note_content', { path: entry.path })
      } else {
        content = await mockInvoke<string>('get_note_content', { path: entry.path })
      }
      setTabs((prev) => {
        if (prev.some((t) => t.entry.path === entry.path)) return prev
        return [...prev, { entry, content }]
      })
      setActiveTabPath(entry.path)
    } catch (err) {
      console.warn('Failed to load note content:', err)
      setTabs((prev) => {
        if (prev.some((t) => t.entry.path === entry.path)) return prev
        return [...prev, { entry, content: '' }]
      })
      setActiveTabPath(entry.path)
    }
  }, [])

  const handleCloseTab = useCallback((path: string) => {
    setTabs((prev) => {
      const next = prev.filter((t) => t.entry.path !== path)
      // If closing active tab, switch to adjacent tab
      if (path === activeTabPath && next.length > 0) {
        const closedIdx = prev.findIndex((t) => t.entry.path === path)
        const newIdx = Math.min(closedIdx, next.length - 1)
        setActiveTabPath(next[newIdx].entry.path)
      } else if (next.length === 0) {
        setActiveTabPath(null)
      }
      return next
    })
  }, [activeTabPath])
  handleCloseTabRef.current = handleCloseTab

  const handleSwitchTab = useCallback((path: string) => {
    setActiveTabPath(path)
  }, [])

  const handleNavigateWikilink = useCallback((target: string) => {
    // Find entry by various matching strategies:
    // 1. Exact title match (case-insensitive)
    // 2. Alias match
    // 3. Path-based match (e.g., "responsibility/grow-newsletter" matches path ending with that)
    // 4. Slug-to-title match (e.g., "grow-newsletter" → "Grow Newsletter")
    
    const targetLower = target.toLowerCase()
    
    // Convert slug to title case for comparison (e.g., "grow-newsletter" → "grow newsletter")
    const slugToWords = (s: string) => s.replace(/-/g, ' ').toLowerCase()
    const targetAsWords = slugToWords(target.split('/').pop() ?? target)
    
    const found = entries.find((e) => {
      // 1. Exact title match
      if (e.title.toLowerCase() === targetLower) return true
      
      // 2. Alias match
      if (e.aliases.some((a) => a.toLowerCase() === targetLower)) return true
      
      // 3. Path-based match: target like "responsibility/grow-newsletter"
      const pathStem = e.path.replace(/^.*\/Laputa\//, '').replace(/\.md$/, '')
      if (pathStem.toLowerCase() === targetLower) return true
      
      // 4. Match just the filename stem
      const fileStem = e.filename.replace(/\.md$/, '')
      if (fileStem.toLowerCase() === targetLower.split('/').pop()) return true
      
      // 5. Slug-to-title match: "grow-newsletter" matches "Grow Newsletter"
      if (e.title.toLowerCase() === targetAsWords) return true
      
      return false
    })
    
    if (found) {
      handleSelectNote(found)
    } else {
      console.warn(`Navigation target not found: ${target}`)
    }
  }, [entries, handleSelectNote])

  const handleCreateNote = useCallback(async (title: string, type: NoteType) => {
    // Build file path: type determines folder
    const typeToFolder: Record<string, string> = {
      Note: 'note',
      Project: 'project',
      Experiment: 'experiment',
      Responsibility: 'responsibility',
      Procedure: 'procedure',
      Person: 'person',
      Event: 'event',
      Topic: 'topic',
    }
    const folder = typeToFolder[type] || 'note'
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
    const path = `/Users/luca/Laputa/${folder}/${slug}.md`
    const now = Math.floor(Date.now() / 1000)

    const newEntry: VaultEntry = {
      path,
      filename: `${slug}.md`,
      title,
      isA: type,
      aliases: [],
      belongsTo: [],
      relatedTo: [],
      status: type === 'Topic' || type === 'Person' ? null : 'Active',
      owner: null,
      cadence: null,
      modifiedAt: now,
      fileSize: 0,
    }

    const frontmatter = [
      '---',
      `title: ${title}`,
      `is_a: ${type}`,
      ...(newEntry.status ? [`status: ${newEntry.status}`] : []),
      '---',
    ].join('\n')
    const content = `${frontmatter}\n\n# ${title}\n\n`

    if (isTauri()) {
      // TODO: Add Tauri command for creating notes
    } else {
      addMockEntry(newEntry, content)
    }

    setEntries((prev) => [newEntry, ...prev])
    setAllContent((prev) => ({ ...prev, [path]: content }))

    // Open the new note
    handleSelectNote(newEntry)
  }, [handleSelectNote])

  const handleSidebarResize = useCallback((delta: number) => {
    setSidebarWidth((w) => Math.max(150, Math.min(400, w + delta)))
  }, [])

  const handleNoteListResize = useCallback((delta: number) => {
    setNoteListWidth((w) => Math.max(200, Math.min(500, w + delta)))
  }, [])

  const handleInspectorResize = useCallback((delta: number) => {
    // Inspector resize is inverted: dragging left makes it wider
    setInspectorWidth((w) => Math.max(200, Math.min(500, w - delta)))
  }, [])

  const activeTab = tabs.find((t) => t.entry.path === activeTabPath) ?? null

  // Frontmatter update handlers
  const handleUpdateFrontmatter = useCallback(async (path: string, key: string, value: FrontmatterValue) => {
    try {
      let newContent: string
      if (isTauri()) {
        // Convert value to the format expected by Rust
        let rustValue: unknown = value
        if (Array.isArray(value)) {
          rustValue = value
        } else if (typeof value === 'boolean') {
          rustValue = value
        } else if (typeof value === 'number') {
          rustValue = value
        } else if (value === null) {
          rustValue = null
        } else {
          rustValue = String(value)
        }
        newContent = await invoke<string>('update_frontmatter', { path, key, value: rustValue })
      } else {
        // Mock implementation for browser testing
        newContent = updateMockFrontmatter(path, key, value)
        updateMockContent(path, newContent)
      }
      
      // Update the tab content
      setTabs((prev) => prev.map((t) => 
        t.entry.path === path ? { ...t, content: newContent } : t
      ))
      
      // Update allContent for backlinks
      setAllContent((prev) => ({ ...prev, [path]: newContent }))
      
      setToastMessage('Property updated')
    } catch (err) {
      console.error('Failed to update frontmatter:', err)
      setToastMessage('Failed to update property')
    }
  }, [])

  const handleDeleteProperty = useCallback(async (path: string, key: string) => {
    try {
      let newContent: string
      if (isTauri()) {
        newContent = await invoke<string>('delete_frontmatter_property', { path, key })
      } else {
        // Mock implementation
        newContent = deleteMockFrontmatterProperty(path, key)
        updateMockContent(path, newContent)
      }
      
      setTabs((prev) => prev.map((t) => 
        t.entry.path === path ? { ...t, content: newContent } : t
      ))
      
      setAllContent((prev) => ({ ...prev, [path]: newContent }))
      
      setToastMessage('Property deleted')
    } catch (err) {
      console.error('Failed to delete property:', err)
      setToastMessage('Failed to delete property')
    }
  }, [])

  const handleAddProperty = useCallback(async (path: string, key: string, value: FrontmatterValue) => {
    // Adding is the same as updating for new keys
    return handleUpdateFrontmatter(path, key, value)
  }, [handleUpdateFrontmatter])

  return (
    <div className="app">
      <div className="app__sidebar" style={{ width: sidebarWidth }}>
        <Sidebar entries={entries} selection={selection} onSelect={setSelection} onSelectNote={handleSelectNote} />
      </div>
      <ResizeHandle onResize={handleSidebarResize} />
      <div className="app__note-list" style={{ width: noteListWidth }}>
        <NoteList entries={entries} selection={selection} selectedNote={activeTab?.entry ?? null} allContent={allContent} onSelectNote={handleSelectNote} onCreateNote={() => setShowCreateDialog(true)} />
      </div>
      <ResizeHandle onResize={handleNoteListResize} />
      <div className="app__editor">
        <Editor
          tabs={tabs}
          activeTabPath={activeTabPath}
          onSwitchTab={handleSwitchTab}
          onCloseTab={handleCloseTab}
          onNavigateWikilink={handleNavigateWikilink}
        />
      </div>
      {!inspectorCollapsed && <ResizeHandle onResize={handleInspectorResize} />}
      <div
        className="app__inspector"
        style={{ width: inspectorCollapsed ? 40 : inspectorWidth }}
      >
        <Inspector
          collapsed={inspectorCollapsed}
          onToggle={() => setInspectorCollapsed((c) => !c)}
          entry={activeTab?.entry ?? null}
          content={activeTab?.content ?? null}
          entries={entries}
          allContent={allContent}
          gitHistory={gitHistory}
          onNavigate={handleNavigateWikilink}
          onUpdateFrontmatter={handleUpdateFrontmatter}
          onDeleteProperty={handleDeleteProperty}
          onAddProperty={handleAddProperty}
        />
      </div>
      <Toast message={toastMessage} onDismiss={() => setToastMessage(null)} />
      <QuickOpenPalette
        open={showQuickOpen}
        entries={entries}
        onSelect={handleSelectNote}
        onClose={() => setShowQuickOpen(false)}
      />
      <CreateNoteDialog
        open={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        onCreate={handleCreateNote}
      />
    </div>
  )
}

export default App
