import { useEffect, useId, useMemo, useState } from 'react'
import { CATEGORIES } from './seed.js'
import { keepFocusInside } from './dialog.js'
import { LANE_LABELS as STATUS_LABELS } from './lanes.js'

function archivedOn(timestamp) {
  if (!timestamp) return ''
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(timestamp))
}

export default function CardArchiveModal({ cards, onClose, onRestore, onDeletePermanently }) {
  const titleId = useId()
  const searchId = useId()
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => {
    const value = query.trim().toLowerCase()
    if (!value) return cards
    return cards.filter((card) => [
      card.title,
      card.details,
      card.contact,
      CATEGORIES[card.category]?.label || card.category,
      STATUS_LABELS[card.status] || card.status,
    ].filter(Boolean).join(' ').toLowerCase().includes(value))
  }, [cards, query])

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
        className="modal card-archive-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={keepFocusInside}
      >
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close task archive">✕</button>
        <h2 className="modal-title" id={titleId}>Task archive</h2>
        <p className="modal-intro">Archived tasks keep their steps, notes, files, emails, and research. Restore them whenever work resumes.</p>

        <label className="archive-search" htmlFor={searchId}>
          <span>Search archived tasks</span>
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search title, details, group, or status …"
            autoFocus
          />
        </label>

        <div className="archive-result-head">
          <strong>{filtered.length} {filtered.length === 1 ? 'task' : 'tasks'}</strong>
          {query && <span>matching “{query}”</span>}
        </div>

        {filtered.length > 0 ? (
          <ul className="archived-card-list">
            {filtered.map((card) => {
              const category = CATEGORIES[card.category]?.label || card.category || 'Uncategorized'
              return (
                <li className="archived-card-row" key={card.id}>
                  <span className={`archived-card-status status-${card.status}`} aria-hidden="true" />
                  <span className="archived-card-copy">
                    <strong>{card.title}</strong>
                    <small>
                      {category} · {STATUS_LABELS[card.status] || card.status} · Archived {archivedOn(card.archivedAt)}
                    </small>
                    <span>
                      {card.subtaskCount || 0} steps · {(card.documents || []).length} files · {(card.comments || []).length} notes
                    </span>
                  </span>
                  <span className="archived-card-actions">
                    <button type="button" className="btn tiny" onClick={() => onRestore(card)}>Restore</button>
                    <button
                      type="button"
                      className="btn tiny danger"
                      onClick={() => {
                        if (confirm(`Permanently delete “${card.title}” and all of its files and history? This cannot be undone.`)) {
                          onDeletePermanently(card)
                        }
                      }}
                    >
                      Delete permanently
                    </button>
                  </span>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="stored-board-empty">{cards.length ? 'No archived tasks match this search.' : 'No archived tasks.'}</p>
        )}

        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Close</button>
        </div>
      </section>
    </div>
  )
}
