import { useState, useEffect, useRef } from 'react'
import './CommitDialog.css'

interface CommitDialogProps {
  open: boolean
  modifiedCount: number
  onCommit: (message: string) => void
  onClose: () => void
}

export function CommitDialog({ open, modifiedCount, onCommit, onClose }: CommitDialogProps) {
  const [message, setMessage] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (open) {
      setMessage('')
      // Focus with a small delay to ensure the dialog is rendered
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  if (!open) return null

  const handleSubmit = () => {
    const trimmed = message.trim()
    if (!trimmed) return
    onCommit(trimmed)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSubmit()
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  return (
    <div className="commit-dialog__overlay" onClick={onClose}>
      <div className="commit-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="commit-dialog__header">
          <h3>Commit & Push</h3>
          <span className="commit-dialog__count">{modifiedCount} file{modifiedCount !== 1 ? 's' : ''} changed</span>
        </div>
        <textarea
          ref={inputRef}
          className="commit-dialog__input"
          placeholder="Commit message..."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={3}
        />
        <div className="commit-dialog__footer">
          <span className="commit-dialog__hint">Cmd+Enter to commit</span>
          <div className="commit-dialog__actions">
            <button className="commit-dialog__cancel" onClick={onClose}>
              Cancel
            </button>
            <button
              className="commit-dialog__submit"
              onClick={handleSubmit}
              disabled={!message.trim()}
            >
              Commit & Push
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
