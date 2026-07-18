import { useEffect, useMemo, useRef, useState } from 'react'
import { CATEGORIES, PHASES } from './seed.js'
import { api } from './api.js'
import CardModal from './CardModal.jsx'
import BoardModal from './BoardModal.jsx'

const COLUMNS = [
  { id: 'todo', title: 'To Do' },
  { id: 'progress', title: 'In Progress' },
  { id: 'done', title: 'Done' },
]

const LAST_BOARD_KEY = 'plainlane-last-board'
const uid = () => `c-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
const catLabel = (key) => CATEGORIES[key]?.label || key

export default function App() {
  const [boards, setBoards] = useState([])
  const [activeBoardId, setActiveBoardId] = useState(null)
  const [cards, setCards] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [openId, setOpenId] = useState(null)
  const [filterCat, setFilterCat] = useState('all')
  const [filterPhase, setFilterPhase] = useState('all')
  const [query, setQuery] = useState('')
  const [boardModal, setBoardModal] = useState(null) // null | { board? }
  const [aiStatus, setAiStatus] = useState({ configured: false, model: '' })
  const [dragId, setDragId] = useState(null)
  const [dragOverCol, setDragOverCol] = useState(null)
  const fileInputRef = useRef(null)

  const activeBoard = boards.find((b) => b.id === activeBoardId) || null
  // ---------- Loading ----------
  async function loadCards(boardId) {
    try {
      const data = await api.listCards(boardId)
      setCards(data)
      setError(null)
    } catch (e) {
      console.error(e)
      setError('Cards could not be loaded.')
    }
  }

  async function boot() {
    try {
      const bs = await api.listBoards()
      setBoards(bs)
      const saved = localStorage.getItem(LAST_BOARD_KEY)
      const chosen = bs.find((b) => b.id === saved)?.id || bs[0]?.id
      setActiveBoardId(chosen)
      if (chosen) await loadCards(chosen)
      setError(null)
    } catch (e) {
      console.error(e)
      setError('Cannot reach the Plainlane server. Is the stack running?')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    boot()
    api.aiStatus().then(setAiStatus).catch(() => {})
  }, [])

  function selectBoard(id) {
    if (id === activeBoardId) return
    setActiveBoardId(id)
    localStorage.setItem(LAST_BOARD_KEY, id)
    setFilterCat('all')
    setFilterPhase('all')
    setQuery('')
    setOpenId(null)
    setCards([])
    loadCards(id)
  }

  async function refreshBoards() {
    try { setBoards(await api.listBoards()) } catch (e) { console.error(e) }
  }

  function onApiError(e) {
    console.error(e)
    setError('Saving failed. Reloading from the server …')
    if (activeBoardId) loadCards(activeBoardId)
  }

  const openCard = cards.find((c) => c.id === openId) || null

  // ---------- Filter options from existing cards ----------
  const catOptions = useMemo(
    () => [...new Set(cards.map((c) => c.category).filter(Boolean))],
    [cards]
  )
  const phaseOptions = useMemo(
    () => [...new Set(cards.map((c) => c.phase).filter(Boolean))],
    [cards]
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return cards.filter((c) => {
      if (filterCat !== 'all' && c.category !== filterCat) return false
      if (filterPhase !== 'all' && c.phase !== filterPhase) return false
      if (q) {
        const researchText = (c.researchRuns || [])
          .map((run) => `${run.question} ${run.summary}`)
          .join(' ')
        const documentText = (c.documents || []).map((document) => `${document.filename} ${document.note || ''}`).join(' ')
        const hay = `${c.title} ${c.details || ''} ${c.contact || ''} ${researchText} ${documentText}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [cards, filterCat, filterPhase, query])

  // ---------- Metrics ----------
  const stats = useMemo(() => {
    const t = { todo: 0, progress: 0, done: 0 }
    for (const c of cards) {
      t[c.status] = (t[c.status] || 0) + 1
    }
    const total = cards.length
    return { ...t, total, donePct: total ? Math.round((t.done / total) * 100) : 0 }
  }, [cards])

  // ---------- Card actions ----------
  function moveCard(id, status) {
    setCards((cs) => cs.map((c) => (c.id === id ? { ...c, status } : c)))
    api.update(id, { status }).then(refreshBoards).catch(onApiError)
  }
  function updateCard(id, patch) {
    setCards((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)))
    api.update(id, patch).catch(onApiError)
  }
  function deleteCard(id) {
    setCards((cs) => cs.filter((c) => c.id !== id))
    if (openId === id) setOpenId(null)
    api.remove(id).then(refreshBoards).catch(onApiError)
  }
  function addCard(status = 'todo') {
    if (!activeBoardId) return
    const nc = {
      id: uid(),
      board_id: activeBoardId,
      title: 'New task',
      category: 'general',
      phase: '',
      details: '',
      contact: '',
      status,
      comments: [],
      researchRuns: [],
      documents: [],
      createdAt: Date.now(),
    }
    setCards((cs) => [...cs, nc])
    setOpenId(nc.id)
    api.create(nc).then(refreshBoards).catch(onApiError)
  }
  async function addComment(id, text) {
    try {
      const cm = await api.addComment(id, text)
      setCards((cs) => cs.map((c) => (c.id === id ? { ...c, comments: [...c.comments, cm] } : c)))
    } catch (e) { onApiError(e) }
  }
  function deleteComment(cardId, commentId) {
    setCards((cs) => cs.map((c) => (
      c.id === cardId ? { ...c, comments: c.comments.filter((m) => m.id !== commentId) } : c
    )))
    api.removeComment(commentId).catch(onApiError)
  }
  async function researchCard(id, question) {
    const run = await api.research(id, question)
    setCards((cs) => cs.map((card) => (
      card.id === id ? { ...card, researchRuns: [run, ...(card.researchRuns || [])] } : card
    )))
    return run
  }
  function deleteResearch(cardId, researchId) {
    setCards((cs) => cs.map((card) => (
      card.id === cardId
        ? { ...card, researchRuns: (card.researchRuns || []).filter((run) => run.id !== researchId) }
        : card
    )))
    api.removeResearch(researchId).catch(onApiError)
  }
  async function addDocument(cardId, payload) {
    const document = await api.addDocument(cardId, payload)
    setCards((cs) => cs.map((card) => (
      card.id === cardId
        ? { ...card, documents: [document, ...(card.documents || [])] }
        : card
    )))
    return document
  }
  async function updateDocument(cardId, documentId, patch) {
    const updated = await api.updateDocument(documentId, patch)
    setCards((cs) => cs.map((card) => (
      card.id === cardId
        ? { ...card, documents: (card.documents || []).map((document) => document.id === documentId ? updated : document) }
        : card
    )))
    return updated
  }
  function deleteDocument(cardId, documentId) {
    setCards((cs) => cs.map((card) => (
      card.id === cardId
        ? { ...card, documents: (card.documents || []).filter((document) => document.id !== documentId) }
        : card
    )))
    api.removeDocument(documentId).catch(onApiError)
  }

  // ---------- Subtask actions ----------
  async function addSubtask(cardId, title) {
    const subtask = await api.addSubtask(cardId, title)
    setCards((cs) => cs.map((card) => {
      if (card.id === cardId) {
        const subtasks = [...(card.subtasks || []), subtask]
        const finalStatuses = new Set(['done', 'wont_do', 'old', 'question'])
        const doneCount = subtasks.filter(s => s.status === 'done').length
        const finalCount = subtasks.filter(s => finalStatuses.has(s.status)).length
        const completionPct = subtasks.length > 0 ? Math.round((finalCount / subtasks.length) * 100) : 100
        return { ...card, subtasks, doneCount, subtaskCount: subtasks.length, completionPct }
      }
      return card
    }))
    return subtask
  }
  async function updateSubtask(subtaskId, patch) {
    const updated = await api.updateSubtask(subtaskId, patch)
    setCards((cs) => cs.map((card) => {
      const foundSubtask = (card.subtasks || []).find(s => s.id === subtaskId)
      if (foundSubtask) {
        const subtasks = card.subtasks.map((s) => s.id === subtaskId ? updated : s)
        const finalStatuses = new Set(['done', 'wont_do', 'old', 'question'])
        const doneCount = subtasks.filter(s => s.status === 'done').length
        const finalCount = subtasks.filter(s => finalStatuses.has(s.status)).length
        const completionPct = subtasks.length > 0 ? Math.round((finalCount / subtasks.length) * 100) : 100
        return { ...card, subtasks, doneCount, subtaskCount: subtasks.length, completionPct }
      }
      return card
    }))
    return updated
  }
  function deleteSubtask(cardId, subtaskId) {
    setCards((cs) => cs.map((card) => {
      if (card.id === cardId) {
        const subtasks = (card.subtasks || []).filter((s) => s.id !== subtaskId)
        const finalStatuses = new Set(['done', 'wont_do', 'old', 'question'])
        const doneCount = subtasks.filter(s => s.status === 'done').length
        const finalCount = subtasks.filter(s => finalStatuses.has(s.status)).length
        const completionPct = subtasks.length > 0 ? Math.round((finalCount / subtasks.length) * 100) : 100
        return { ...card, subtasks, doneCount, subtaskCount: subtasks.length, completionPct }
      }
      return card
    }))
    api.removeSubtask(subtaskId).catch(onApiError)
  }

  // ---------- Board actions ----------
  async function saveBoard(data) {
    try {
      if (boardModal?.board) {
        const updated = await api.updateBoard(boardModal.board.id, data)
        setBoards((bs) => bs.map((b) => (b.id === updated.id ? { ...b, ...updated } : b)))
      } else {
        const created = await api.createBoard(data)
        setBoards((bs) => [...bs, created])
        selectBoard(created.id)
      }
      setBoardModal(null)
    } catch (e) { onApiError(e) }
  }
  async function deleteBoard() {
    const id = boardModal?.board?.id
    if (!id) return
    try {
      await api.removeBoard(id)
      const rest = boards.filter((b) => b.id !== id)
      setBoards(rest)
      setBoardModal(null)
      if (activeBoardId === id && rest[0]) selectBoard(rest[0].id)
    } catch (e) { onApiError(e) }
  }

  // ---------- Drag and drop ----------
  function onDrop(colId) {
    if (dragId) moveCard(dragId, colId)
    setDragId(null)
    setDragOverCol(null)
  }

  // ---------- Export and import ----------
  async function exportJson() {
    if (!activeBoardId) return
    try {
      const backup = await api.exportBoard(activeBoardId)
      const slug = (activeBoard?.name || 'board').toLowerCase().replace(/[^a-z0-9]+/g, '-')
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${slug}-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      onApiError(error)
    }
  }
  function importJson(e) {
    const file = e.target.files?.[0]
    if (!file || !activeBoardId) return
    const reader = new FileReader()
    reader.onload = async () => {
      try {
        const data = JSON.parse(reader.result)
        if (!Array.isArray(data)) return alert('Invalid backup format.')
        if (!confirm(`Replace all cards in “${activeBoard.name}” with ${data.length} imported cards?`)) return
        setCards(await api.importBoard(activeBoardId, data))
        refreshBoards()
      } catch (err) { alert('The backup could not be imported.'); console.error(err) }
    }
    reader.readAsText(file)
    e.target.value = ''
  }
  const accent = activeBoard?.accent || '#e11d48'

  return (
    <div className="app" style={{ '--accent': accent }}>
      <a className="skip-link" href="#main-board">Skip to board</a>
      {/* Board navigation */}
      <nav className="boardbar" aria-label="Boards">
        <a className="app-wordmark" href="#main-board" aria-label="Plainlane board">Plainlane</a>
        <div className="boardbar-scroll">
          {boards.map((b) => {
            const isActive = b.id === activeBoardId
            const open = isActive ? stats.total - stats.done : b.openCount
            return (
              <button
                type="button"
                key={b.id}
                className={`board-pill ${isActive ? 'active' : ''}`}
                style={{ '--pill': b.accent }}
                onClick={() => selectBoard(b.id)}
                aria-pressed={isActive}
                aria-label={`Open ${b.name}. ${open} open ${open === 1 ? 'task' : 'tasks'}.`}
              >
                <span className="board-pill-emoji" aria-hidden="true">{b.emoji}</span>
                <span className="board-pill-name">{b.name}</span>
                <span className="board-pill-count" aria-hidden="true">{open}</span>
              </button>
            )
          })}
        </div>
        <button type="button" className="board-add" onClick={() => setBoardModal({})}>+ Board</button>
      </nav>

      {/* Header */}
      <header className="topbar">
        <div className="brand">
          <span className="flag" aria-hidden="true">{activeBoard?.emoji || '🗂️'}</span>
          <div>
            <h1>
              {activeBoard?.name || 'Board'}
              {activeBoard && (
                <button
                  type="button"
                  className="board-edit"
                  title="Edit board"
                  aria-label={`Edit ${activeBoard.name}`}
                  onClick={() => setBoardModal({ board: activeBoard })}
                >⚙</button>
              )}
            </h1>
            <p className="sub">{stats.total} tasks · {stats.done} completed</p>
          </div>
        </div>

        <div className="topactions">
          <button type="button" className="btn ghost" onClick={exportJson}>Export</button>
          <button type="button" className="btn ghost" onClick={() => fileInputRef.current?.click()}>Import</button>
          <input type="file" accept="application/json" ref={fileInputRef} onChange={importJson} hidden />
        </div>
      </header>

      {error && (
        <div className="banner error" role="alert">
          {error} <button type="button" className="btn tiny" onClick={() => activeBoardId && loadCards(activeBoardId)}>Reload</button>
        </div>
      )}

      {/* Status metrics */}
      <section className="dashboard" aria-label="Board status">
        <StatTile label="To Do" value={stats.todo} tone="muted" />
        <StatTile label="In Progress" value={stats.progress} tone="accent" />
        <StatTile label="Done" value={`${stats.done}`} sub={`${stats.donePct}%`} tone="ok" />
      </section>

      <div
        className="progressbar-wrap"
        role="progressbar"
        aria-label="Board completion"
        aria-valuemin="0"
        aria-valuemax={Math.max(stats.total, 1)}
        aria-valuenow={stats.done}
        aria-valuetext={`${stats.done} of ${stats.total} tasks completed`}
      >
        <div className="progressbar" style={{ width: `${stats.donePct}%` }} />
      </div>

      {/* Filters */}
      <section className="filters" aria-label="Board filters">
        <input
          type="search"
          className="search"
          aria-label="Search tasks"
          placeholder="Search tasks…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {phaseOptions.length > 0 && (
          <select aria-label="Filter by phase" value={filterPhase} onChange={(e) => setFilterPhase(e.target.value)}>
            <option value="all">All phases</option>
            {phaseOptions.map((k) => <option key={k} value={k}>{PHASES[k]?.label || k}</option>)}
          </select>
        )}
        {catOptions.length > 0 && (
          <select aria-label="Filter by category" value={filterCat} onChange={(e) => setFilterCat(e.target.value)}>
            <option value="all">All categories</option>
            {catOptions.map((k) => <option key={k} value={k}>{catLabel(k)}</option>)}
          </select>
        )}
        {(filterCat !== 'all' || filterPhase !== 'all' || query) && (
          <button type="button" className="btn tiny" onClick={() => { setFilterCat('all'); setFilterPhase('all'); setQuery('') }}>
            Clear filters
          </button>
        )}
      </section>

      {loading ? (
        <div className="loading" role="status" aria-live="polite">Loading board …</div>
      ) : (
        <main className="board" id="main-board" aria-label={activeBoard ? `${activeBoard.name} Kanban board` : 'Kanban board'}>
          {COLUMNS.map((col) => {
            const colCards = filtered.filter((c) => c.status === col.id)
            const headingId = `column-${col.id}`
            return (
              <section
                key={col.id}
                className={`column ${dragOverCol === col.id ? 'dragover' : ''}`}
                aria-labelledby={headingId}
                onDragOver={(e) => { e.preventDefault(); setDragOverCol(col.id) }}
                onDragLeave={() => setDragOverCol((v) => (v === col.id ? null : v))}
                onDrop={() => onDrop(col.id)}
              >
                <div className="column-head">
                  <h2 id={headingId}>{col.title}</h2>
                  <span className="count" aria-label={`${colCards.length} ${colCards.length === 1 ? 'task' : 'tasks'}`}>{colCards.length}</span>
                </div>
                <div className="column-body">
                  {colCards.map((card) => (
                    <CardTile
                      key={card.id}
                      card={card}
                      onOpen={() => setOpenId(card.id)}
                      onDragStart={() => setDragId(card.id)}
                      onDragEnd={() => { setDragId(null); setDragOverCol(null) }}
                      onMove={(status) => moveCard(card.id, status)}
                    />
                  ))}
                  {colCards.length === 0 && <div className="empty">No tasks here</div>}
                </div>
                <button type="button" className="addcard" onClick={() => addCard(col.id)}>+ Add task</button>
              </section>
            )
          })}
        </main>
      )}

      {openCard && (
        <CardModal
          card={openCard}
          onClose={() => setOpenId(null)}
          onUpdate={(patch) => updateCard(openCard.id, patch)}
          onDelete={() => deleteCard(openCard.id)}
          onAddComment={(text) => addComment(openCard.id, text)}
          onDeleteComment={(cid) => deleteComment(openCard.id, cid)}
          aiStatus={aiStatus}
          onResearch={(question) => researchCard(openCard.id, question)}
          onDeleteResearch={(researchId) => deleteResearch(openCard.id, researchId)}
          onAddDocument={(payload) => addDocument(openCard.id, payload)}
          onUpdateDocument={(documentId, patch) => updateDocument(openCard.id, documentId, patch)}
          onDeleteDocument={(documentId) => deleteDocument(openCard.id, documentId)}
          onAddSubtask={(title) => addSubtask(openCard.id, title)}
          onUpdateSubtask={updateSubtask}
          onDeleteSubtask={(subtaskId) => deleteSubtask(openCard.id, subtaskId)}
          boardSubtaskLimit={boards.find(b => b.id === openCard.board_id)?.subtask_limit || 10}
        />
      )}

      {boardModal && (
        <BoardModal
          board={boardModal.board}
          canDelete={boards.length > 1}
          onClose={() => setBoardModal(null)}
          onSave={saveBoard}
          onDelete={deleteBoard}
        />
      )}

    </div>
  )
}

function StatTile({ label, value, sub, tone = 'muted' }) {
  return (
    <div className={`stat-tile tone-${tone}`} aria-label={`${label}: ${value}${sub ? `, ${sub}` : ''}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}{sub && <em className="stat-sub">{sub}</em>}</span>
    </div>
  )
}

function CardTile({ card, onOpen, onDragStart, onDragEnd, onMove }) {
  const cat = CATEGORIES[card.category] || { label: card.category, color: '#888' }
  const phase = PHASES[card.phase]
  const nextStatus = card.status === 'todo' ? 'progress' : card.status === 'progress' ? 'done' : null
  const prevStatus = card.status === 'done' ? 'progress' : card.status === 'progress' ? 'todo' : null
  const statusLabel = { todo: 'To Do', progress: 'In Progress', done: 'Done' }

  return (
    <article
      className="card"
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      style={{ '--cat': cat.color }}
    >
      <button type="button" className="card-open" onClick={onOpen} aria-label={`Open task: ${card.title}`}>
        <span className="card-tags">
          {card.category && <span className="tag cat">{cat.label}</span>}
          {phase && <span className="tag phase" style={{ '--ph': phase.color }}>{phase.label}</span>}
        </span>
        <span className="card-title" role="heading" aria-level="3">{card.title}</span>
        {card.contact && <span className="card-contact">{card.contact}</span>}
      </button>
      <div className="card-foot">
        <div className="card-chips">
          {card.status === 'done' && <span className="badge badge-done">✓ Done</span>}
          {card.status !== 'done' && card.completionPct !== undefined && card.subtaskCount > 0 && (
            <span className={`badge badge-progress badge-${card.completionPct === 100 ? 'ready' : 'progress'}`}>
              {card.doneCount}/{card.subtaskCount}
            </span>
          )}
          {(card.comments || []).length > 0 && <span className="chip" aria-label={`${card.comments.length} comments`}>💬 {card.comments.length}</span>}
          {(card.researchRuns || []).length > 0 && <span className="chip ai-chip" aria-label={`${card.researchRuns.length} research results`}>AI {card.researchRuns.length}</span>}
          {(card.documents || []).length > 0 && <span className="chip document-chip" aria-label={`${card.documents.length} attachments`}>📎 {card.documents.length}</span>}
          {(card.subtasks || []).length > 0 && <span className="chip subtask-chip" aria-label={`${card.subtasks.length} subtasks`}>📋 {card.subtasks.length}</span>}
        </div>
        <div className="movebtns">
          {prevStatus && (
            <button type="button" title="Move back" aria-label={`Move ${card.title} to ${statusLabel[prevStatus]}`} onClick={() => onMove(prevStatus)}>◀</button>
          )}
          {nextStatus && (
            <button type="button" title="Move forward" aria-label={`Move ${card.title} to ${statusLabel[nextStatus]}`} onClick={() => onMove(nextStatus)}>▶</button>
          )}
        </div>
      </div>
    </article>
  )
}
