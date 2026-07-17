import { useEffect, useId, useState } from 'react'
import { keepFocusInside } from './dialog.js'

const ACCENTS = ['#e11d48', '#ea580c', '#f59e0b', '#16a34a', '#0d9488', '#0ea5e9', '#4f46e5', '#8b5cf6', '#db2777', '#64748b']
const EMOJI_SUGGESTIONS = ['🗂️', '🏠', '💼', '✈️', '🚗', '💰', '🩺', '🎓', '🛠️', '🎉', '🐕', '📦']

export default function BoardModal({ board, canDelete, onClose, onSave, onDelete }) {
  const isEdit = Boolean(board)
  const [name, setName] = useState(board?.name || '')
  const [emoji, setEmoji] = useState(board?.emoji || '🗂️')
  const [accent, setAccent] = useState(board?.accent || '#4f46e5')
  const titleId = useId()

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  useEffect(() => {
    const previousFocus = document.activeElement
    return () => { if (previousFocus instanceof HTMLElement) previousFocus.focus() }
  }, [])

  function submit(e) {
    e.preventDefault()
    onSave({ name: name.trim() || 'New board', emoji: emoji.trim() || '🗂️', accent })
  }

  return (
    <div className="overlay" onClick={onClose}>
      <form
        className="modal board-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={keepFocusInside}
        onSubmit={submit}
        style={{ '--cat': accent }}
      >
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close board editor">✕</button>
        <h2 className="modal-title" id={titleId}>{isEdit ? 'Edit board' : 'New board'}</h2>

        <div className="board-preview" style={{ '--accent': accent }}>
          <span className="board-preview-emoji">{emoji || '🗂️'}</span>
          <span className="board-preview-name">{name || 'Board name'}</span>
        </div>

        <label className="field">Name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="For example Home, Finance, Trip …" autoFocus />
        </label>

        <label className="field">Icon
          <input className="emoji-input" value={emoji} onChange={(e) => setEmoji(e.target.value)} maxLength={4} />
        </label>
        <div className="emoji-row" role="group" aria-label="Suggested board icons">
          {EMOJI_SUGGESTIONS.map((e) => (
            <button
              type="button"
              key={e}
              className={`emoji-chip ${emoji === e ? 'active' : ''}`}
              onClick={() => setEmoji(e)}
              aria-label={`Use ${e} as the board icon`}
              aria-pressed={emoji === e}
            >{e}</button>
          ))}
        </div>

        <div className="field-label" id="board-colour-label">Colour</div>
        <div className="accent-row" role="group" aria-labelledby="board-colour-label">
          {ACCENTS.map((c) => (
            <button
              type="button"
              key={c}
              className={`accent-swatch ${accent === c ? 'active' : ''}`}
              style={{ background: c }}
              onClick={() => setAccent(c)}
              aria-label={`Use colour ${c}`}
              aria-pressed={accent === c}
            />
          ))}
        </div>

        <div className="modal-actions board-modal-actions">
          <button type="submit" className="btn primary">{isEdit ? 'Save' : 'Create board'}</button>
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          {isEdit && canDelete && (
            <button
              type="button"
              className="btn danger board-delete"
              onClick={() => { if (confirm(`Delete “${board.name}” and all of its cards?`)) onDelete() }}
            >
              Delete board
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
