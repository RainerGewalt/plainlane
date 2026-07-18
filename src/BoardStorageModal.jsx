import { useEffect, useId } from 'react'
import { keepFocusInside } from './dialog.js'

function storedOn(timestamp) {
  if (!timestamp) return ''
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(timestamp))
}

function BoardRow({ board, state, onRestore, onDeletePermanently }) {
  const count = board.cardCount || 0
  const timestamp = state === 'trash' ? board.deleted_at : board.archived_at
  return (
    <li className="stored-board-row">
      <span className="stored-board-icon" style={{ '--stored-accent': board.accent }} aria-hidden="true">
        {board.emoji || '🗂️'}
      </span>
      <span className="stored-board-copy">
        <strong>{board.name}</strong>
        <small>
          {count} {count === 1 ? 'task' : 'tasks'} · {state === 'trash' ? 'Moved to trash' : 'Archived'} {storedOn(timestamp)}
        </small>
      </span>
      <span className="stored-board-actions">
        <button type="button" className="btn tiny" onClick={() => onRestore(board)}>Restore</button>
        {state === 'trash' && (
          <button
            type="button"
            className="btn tiny danger"
            onClick={() => {
              if (confirm(`Permanently delete “${board.name}” and all of its cards? This cannot be undone.`)) {
                onDeletePermanently(board)
              }
            }}
          >
            Delete permanently
          </button>
        )}
      </span>
    </li>
  )
}

export default function BoardStorageModal({ boards, onClose, onRestore, onDeletePermanently }) {
  const titleId = useId()
  const archived = boards.filter((board) => board.archived_at !== null)
  const trash = boards.filter((board) => board.deleted_at !== null)

  useEffect(() => {
    const handler = (event) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  useEffect(() => {
    const previousFocus = document.activeElement
    return () => { if (previousFocus instanceof HTMLElement) previousFocus.focus() }
  }, [])

  return (
    <div className="overlay" onClick={onClose}>
      <section
        className="modal board-storage-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={keepFocusInside}
      >
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close board storage" autoFocus>✕</button>
        <h2 className="modal-title" id={titleId}>Board storage</h2>
        <p className="modal-intro">Archived boards stay out of the board bar. Boards in trash can be restored or deleted permanently.</p>

        <div className="stored-board-section">
          <div className="stored-board-heading">
            <h3>Archived</h3>
            <span>{archived.length}</span>
          </div>
          {archived.length > 0
            ? <ul className="stored-board-list">{archived.map((board) => <BoardRow key={board.id} board={board} state="archived" onRestore={onRestore} onDeletePermanently={onDeletePermanently} />)}</ul>
            : <p className="stored-board-empty">No archived boards.</p>}
        </div>

        <div className="stored-board-section">
          <div className="stored-board-heading">
            <h3>Trash</h3>
            <span>{trash.length}</span>
          </div>
          {trash.length > 0
            ? <ul className="stored-board-list">{trash.map((board) => <BoardRow key={board.id} board={board} state="trash" onRestore={onRestore} onDeletePermanently={onDeletePermanently} />)}</ul>
            : <p className="stored-board-empty">Trash is empty.</p>}
        </div>

        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Close</button>
        </div>
      </section>
    </div>
  )
}
