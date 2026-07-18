import { useEffect, useId } from 'react'
import { keepFocusInside } from './dialog.js'
import { useForm } from './useForm.js'
import { validateBoard, BOARD_NAME_MAX as NAME_MAX } from './validation.js'

const ACCENTS = ['#e11d48', '#ea580c', '#f59e0b', '#16a34a', '#0d9488', '#0ea5e9', '#4f46e5', '#8b5cf6', '#db2777', '#64748b']
const EMOJI_SUGGESTIONS = ['🗂️', '🏠', '💼', '✈️', '🚗', '💰', '🩺', '🎓', '🛠️', '🎉', '🐕', '📦']

export default function BoardModal({ board, canDelete, onClose, onSave, onDelete }) {
  const isEdit = Boolean(board)
  const titleId = useId()
  const form = useForm(
    {
      name: board?.name || '',
      emoji: board?.emoji || '🗂️',
      accent: board?.accent || '#4f46e5',
      subtaskLimit: String(board?.subtask_limit || 10),
    },
    validateBoard
  )
  const { values, isValid, setValue, showError } = form

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
    form.markAllTouched()
    if (!isValid) return
    onSave({
      name: values.name.trim(),
      emoji: values.emoji.trim(),
      accent: values.accent,
      subtask_limit: Number(values.subtaskLimit),
    })
  }

  const nameError = showError('name')
  const emojiError = showError('emoji')
  const limitError = showError('subtaskLimit')

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
        noValidate
        style={{ '--cat': values.accent }}
      >
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close board editor">✕</button>
        <h2 className="modal-title" id={titleId}>{isEdit ? 'Edit board' : 'New board'}</h2>

        <div className="board-preview" style={{ '--accent': values.accent }}>
          <span className="board-preview-emoji">{values.emoji || '🗂️'}</span>
          <span className="board-preview-name">{values.name.trim() || 'Board name'}</span>
        </div>

        <label className="field">
          <span className="field-head">
            <span>Name</span>
            <span className="field-counter" aria-hidden="true">{values.name.trim().length}/{NAME_MAX}</span>
          </span>
          <input
            {...form.field('name')}
            placeholder="For example Home, Finance, Trip …"
            autoFocus
            maxLength={NAME_MAX + 10}
            aria-invalid={Boolean(nameError)}
            aria-describedby={nameError ? 'board-name-error' : undefined}
          />
          {nameError && <span className="field-error" id="board-name-error" role="alert">{nameError}</span>}
        </label>

        <label className="field">Icon
          <input
            className="emoji-input"
            {...form.field('emoji')}
            maxLength={4}
            aria-invalid={Boolean(emojiError)}
            aria-describedby={emojiError ? 'board-emoji-error' : undefined}
          />
          {emojiError && <span className="field-error" id="board-emoji-error" role="alert">{emojiError}</span>}
        </label>
        <div className="emoji-row" role="group" aria-label="Suggested board icons">
          {EMOJI_SUGGESTIONS.map((e) => (
            <button
              type="button"
              key={e}
              className={`emoji-chip ${values.emoji === e ? 'active' : ''}`}
              onClick={() => setValue('emoji', e)}
              aria-label={`Use ${e} as the board icon`}
              aria-pressed={values.emoji === e}
            >{e}</button>
          ))}
        </div>

        <div className="field-label" id="board-colour-label">Colour</div>
        <div className="accent-row" role="group" aria-labelledby="board-colour-label">
          {ACCENTS.map((c) => (
            <button
              type="button"
              key={c}
              className={`accent-swatch ${values.accent === c ? 'active' : ''}`}
              style={{ background: c }}
              onClick={() => setValue('accent', c)}
              aria-label={`Use colour ${c}`}
              aria-pressed={values.accent === c}
            />
          ))}
        </div>

        <label className="field">Max subtasks per card
          <input
            type="number"
            min="1"
            max="10"
            value={values.subtaskLimit}
            onChange={(e) => setValue('subtaskLimit', e.target.value)}
            onBlur={() => form.markTouched('subtaskLimit')}
            aria-invalid={Boolean(limitError)}
            aria-describedby={limitError ? 'board-limit-error' : 'board-limit-hint'}
          />
          {limitError
            ? <span className="field-error" id="board-limit-error" role="alert">{limitError}</span>
            : <span className="field-hint" id="board-limit-hint">Applies to every card on this board.</span>}
        </label>

        <div className="modal-actions board-modal-actions">
          <button type="submit" className="btn primary" disabled={!isValid}>
            {isEdit ? 'Save changes' : 'Create board'}
          </button>
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
