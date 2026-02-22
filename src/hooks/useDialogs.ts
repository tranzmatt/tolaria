import { useState, useCallback } from 'react'

export function useDialogs() {
  const [showCreateTypeDialog, setShowCreateTypeDialog] = useState(false)
  const [showQuickOpen, setShowQuickOpen] = useState(false)
  const [showCommitDialog, setShowCommitDialog] = useState(false)
  const [showAIChat, setShowAIChat] = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  const openCreateType = useCallback(() => setShowCreateTypeDialog(true), [])
  const closeCreateType = useCallback(() => setShowCreateTypeDialog(false), [])
  const openQuickOpen = useCallback(() => setShowQuickOpen(true), [])
  const closeQuickOpen = useCallback(() => setShowQuickOpen(false), [])
  const openCommitDialog = useCallback(() => setShowCommitDialog(true), [])
  const closeCommitDialog = useCallback(() => setShowCommitDialog(false), [])
  const openSettings = useCallback(() => setShowSettings(true), [])
  const closeSettings = useCallback(() => setShowSettings(false), [])
  const toggleAIChat = useCallback(() => setShowAIChat((c) => !c), [])

  return {
    showCreateTypeDialog, openCreateType, closeCreateType,
    showQuickOpen, openQuickOpen, closeQuickOpen,
    showCommitDialog, openCommitDialog, closeCommitDialog,
    showAIChat, toggleAIChat,
    showSettings, openSettings, closeSettings,
  }
}
