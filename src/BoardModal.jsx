import { useEffect, useId } from 'react'
import { keepFocusInside } from './dialog.js'
import { useForm } from './useForm.js'
import { validateBoard, BOARD_NAME_MAX as NAME_MAX } from './validation.js'

const ACCENTS = ['#e11d48', '#ea580c', '#f59e0b', '#16a34a', '#0d9488', '#0ea5e9', '#4f46e5', '#8b5cf6', '#db2777', '#64748b']
const EMOJI_SUGGESTIONS = ['🗂️', '🏠', '💼', '✈️', '🚗', '💰', '🩺', '🎓', '🛠️', '🎉', '🐕', '📦']

export default function BoardModal({ board, canStore, onClose, onSave, onArchive, onTrash, progressCount = 0 }) {
  const isEdit = Boolean(board)
  const titleId = useId()
  const validate = (values) => {
    const errors = validateBoard(values)
    const requestedLimit = String(values.progressLimit ?? '').trim()
    if (isEdit && requestedLimit && Number(requestedLimit) < progressCount) {
      errors.progressLimit = `In Progress already contains ${progressCount} tasks. Choose at least ${progressCount}.`
    }
    return errors
  }
  const form = useForm(
    {
      name: board?.name || '',
      emoji: board?.emoji || '🗂️',
      accent: board?.accent || '#4f46e5',
      subtaskLimit: String(board?.subtask_limit || 10),
      progressLimit: board?.progress_limit == null ? '' : String(board.progress_limit),
      showLaneAge: Boolean(board?.show_lane_age),
    },
    validate
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
      progress_limit: values.progressLimit.trim() ? Number(values.progressLimit) : null,
      show_lane_age: values.showLaneAge ? 1 : 0,
    })
  }

  const nameError = showError('name')
  const emojiError = showError('emoji')
  const limitError = showError('subtaskLimit')
  const progressLimitError = showError('progressLimit')

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
            aria-describedby={limitError ? 'board-subtask-limit-error' : 'board-subtask-limit-hint'}
          />
          {limitError
            ? <span className="field-error" id="board-subtask-limit-error" role="alert">{limitError}</span>
            : <span className="field-hint" id="board-subtask-limit-hint">Applies to every card on this board.</span>}
        </label>

        <label className="field">Max tasks in In Progress
          <input
            type="number"
            min={Math.max(1, progressCount)}
            max="999"
            placeholder="No limit"
            value={values.progressLimit}
            onChange={(e) => setValue('progressLimit', e.target.value)}
            onBlur={() => form.markTouched('progressLimit')}
            aria-invalid={Boolean(progressLimitError)}
            aria-describedby={progressLimitError ? 'board-progress-limit-error' : 'board-progress-limit-hint'}
          />
          {progressLimitError
            ? <span className="field-error" id="board-progress-limit-error" role="alert">{progressLimitError}</span>
            : <span className="field-hint" id="board-progress-limit-hint">Leave empty for no limit. Subtasks do not count.</span>}
        </label>

        <label className="check-field">
          <input
            type="checkbox"
            checked={values.showLaneAge}
            onChange={(e) => setValue('showLaneAge', e.target.checked)}
          />
          <span>
            <strong>Show time in current column</strong>
            <small>Displays a short age such as 3h or 5d on each task.</small>
          </span>
        </label>

        {isEdit && (
          <div className="board-lifecycle">
            <strong>Board storage</strong>
            <p>Archive hides this board. Trash keeps it recoverable until you delete it permanently from Board storage.</p>
            <div className="board-lifecycle-actions">
              <button
                type="button"
                className="btn ghost"
                onClick={onArchive}
                disabled={!canStore}
                title={canStore ? 'Hide this board in the archive' : 'The last active board cannot be archived'}
              >
                Archive board
              </button>
              <button
                type="button"
                className="btn danger"
                onClick={onTrash}
                disabled={!canStore}
                title={canStore ? 'Move this board to trash' : 'The last active board cannot be moved to trash'}
              >
                Move to trash
              </button>
            </div>
            {!canStore && <small>Keep at least one active board.</small>}
          </div>
        )}

        <div className="modal-actions board-modal-actions">
          <button type="submit" className="btn primary" disabled={!isValid}>
            {isEdit ? 'Save changes' : 'Create board'}
          </button>
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </div>
  )
}
