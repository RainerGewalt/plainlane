import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { CATEGORIES, PHASES } from './seed.js'
import { groupByCategory } from './grouping.js'
import { SUBTASK_STATUSES, isDoneMoveAllowed, subtaskSummary } from './subtasks.js'
import { LANES, LANE_LABELS, laneLabel } from './lanes.js'
import { api } from './api.js'
import { formatLaneAge } from './laneAge.js'
import CardModal from './CardModal.jsx'
import CardArchiveModal from './CardArchiveModal.jsx'
import BoardModal from './BoardModal.jsx'
import BoardStorageModal from './BoardStorageModal.jsx'

const LAST_BOARD_KEY = 'plainlane-last-board'
const uid = () => `c-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
const catLabel = (key) => CATEGORIES[key]?.label || key

export default function App() {
  const [boards, setBoards] = useState([])
  const [storedBoards, setStoredBoards] = useState([])
  const [activeBoardId, setActiveBoardId] = useState(null)
  const [cards, setCards] = useState([])
  const [archivedCards, setArchivedCards] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [openId, setOpenId] = useState(null)
  const [filterCat, setFilterCat] = useState('all')
  const [filterPhase, setFilterPhase] = useState('all')
  const [query, setQuery] = useState('')
  const [boardModal, setBoardModal] = useState(null) // null | { board? }
  const [storageOpen, setStorageOpen] = useState(false)
  const [cardArchiveOpen, setCardArchiveOpen] = useState(false)
  const [aiStatus, setAiStatus] = useState({ configured: false, model: '' })
  const [dragId, setDragId] = useState(null)
  const [dragOverCol, setDragOverCol] = useState(null)
  const [collapsed, setCollapsed] = useState(() => new Set())
  const [clockNow, setClockNow] = useState(Date.now())
  const [undo, setUndo] = useState(null) // null | { id, from, to, title }
  const [boardUndo, setBoardUndo] = useState(null) // null | { id, name, action }
  const [cardArchiveUndo, setCardArchiveUndo] = useState(null) // null | { id, title }
  const fileInputRef = useRef(null)

  const activeBoard = boards.find((b) => b.id === activeBoardId) || null

  useEffect(() => {
    setClockNow(Date.now())
    if (!activeBoard?.show_lane_age) return undefined
    const timer = window.setInterval(() => setClockNow(Date.now()), 60 * 1000)
    return () => window.clearInterval(timer)
  }, [activeBoard?.id, activeBoard?.show_lane_age])

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

  async function loadArchivedCards(boardId) {
    try {
      setArchivedCards(await api.listArchivedCards(boardId))
    } catch (e) {
      console.error(e)
      setError('The task archive could not be loaded.')
    }
  }

  async function boot() {
    try {
      const [bs, stored] = await Promise.all([api.listBoards(), api.listStoredBoards()])
      setBoards(bs)
      setStoredBoards(stored)
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
    setCardArchiveOpen(false)
    setUndo(null)
    setCards([])
    setArchivedCards([])
    loadCards(id)
  }

  async function refreshBoards() {
    try { setBoards(await api.listBoards()) } catch (e) { console.error(e) }
  }

  async function refreshBoardLists() {
    try {
      const [active, stored] = await Promise.all([api.listBoards(), api.listStoredBoards()])
      setBoards(active)
      setStoredBoards(stored)
      return active
    } catch (e) {
      console.error(e)
      return null
    }
  }

  function onApiError(e) {
    console.error(e)
    setError(e?.message || 'Saving failed. Reloading from the server …')
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

  // ---------- Group tasks by category for the collapsible in-column sections ----------
  const categoryGroups = useMemo(
    () => groupByCategory(filtered, Object.keys(CATEGORIES)),
    [filtered]
  )

  // Load the per-board collapsed set whenever the active board changes.
  useEffect(() => {
    if (!activeBoardId) return
    try {
      const raw = localStorage.getItem(`plainlane-collapsed-${activeBoardId}`)
      setCollapsed(new Set(raw ? JSON.parse(raw) : []))
    } catch { setCollapsed(new Set()) }
  }, [activeBoardId])

  // Collapse is tracked per column + category, so a category can stay open in one
  // lane while being folded away in another.
  function toggleGroup(colId, key) {
    const token = `${colId}::${key}`
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(token)) next.delete(token)
      else next.add(token)
      if (activeBoardId) {
        try { localStorage.setItem(`plainlane-collapsed-${activeBoardId}`, JSON.stringify([...next])) } catch {}
      }
      return next
    })
  }

  // Auto-dismiss the undo prompt after a short while.
  useEffect(() => {
    if (!undo) return undefined
    const timer = setTimeout(() => setUndo(null), 8000)
    return () => clearTimeout(timer)
  }, [undo])

  useEffect(() => {
    if (!boardUndo) return undefined
    const timer = setTimeout(() => setBoardUndo(null), 8000)
    return () => clearTimeout(timer)
  }, [boardUndo])

  useEffect(() => {
    if (!cardArchiveUndo) return undefined
    const timer = setTimeout(() => setCardArchiveUndo(null), 8000)
    return () => clearTimeout(timer)
  }, [cardArchiveUndo])

  // ---------- Metrics ----------
  const stats = useMemo(() => {
    const t = { todo: 0, progress: 0, done: 0 }
    for (const c of cards) {
      t[c.status] = (t[c.status] || 0) + 1
    }
    const total = cards.length
    return { ...t, total, donePct: total ? Math.round((t.done / total) * 100) : 0 }
  }, [cards])

  const progressLimit = activeBoard?.progress_limit ?? null
  const progressAtLimit = progressLimit !== null && stats.progress >= progressLimit

  function progressLimitMessage() {
    return `In Progress limit (${progressLimit}) reached. Finish or move a task before adding another.`
  }

  // ---------- Card actions ----------
  async function moveCard(id, status, { record = true } = {}) {
    const card = cards.find((candidate) => candidate.id === id)
    if (!card || card.status === status) return true
    if (status === 'progress' && card.status !== 'progress' && progressAtLimit) {
      setError(progressLimitMessage())
      return false
    }
    if (status === 'done' && !isDoneMoveAllowed(card)) {
      setError(`“${card.title}” still has open subtasks. Finish or mark them before moving it to Done.`)
      return false
    }

    const from = card.status
    const statusChangedAt = Date.now()
    setCards((cs) => cs.map((c) => (c.id === id ? { ...c, status, statusChangedAt } : c)))
    try {
      const updated = await api.update(id, { status })
      setCards((cs) => cs.map((c) => (c.id === id ? updated : c)))
      setError(null)
      if (record) setUndo({ id, from, to: status, title: card.title })
      refreshBoards()
      return true
    } catch (e) {
      onApiError(e)
      return false
    }
  }
  function undoMove() {
    if (!undo) return
    const { id, from } = undo
    setUndo(null)
    moveCard(id, from, { record: false })
  }
  function updateCard(id, patch) {
    setCards((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)))
    api.update(id, patch).catch(onApiError)
  }
  async function archiveCard(id) {
    const card = cards.find((candidate) => candidate.id === id)
    if (!card || !activeBoardId) return
    try {
      await api.archiveCard(id)
      setCards((current) => current.filter((candidate) => candidate.id !== id))
      if (openId === id) setOpenId(null)
      setCardArchiveUndo({ id, title: card.title })
      await Promise.all([refreshBoards(), loadArchivedCards(activeBoardId)])
      setError(null)
    } catch (e) { onApiError(e) }
  }

  async function undoCardArchive() {
    if (!cardArchiveUndo || !activeBoardId) return
    const archived = cardArchiveUndo
    setCardArchiveUndo(null)
    try {
      await api.restoreCard(archived.id)
      await Promise.all([loadCards(activeBoardId), loadArchivedCards(activeBoardId), refreshBoards()])
      setError(null)
    } catch (e) { onApiError(e) }
  }

  async function restoreCard(card) {
    if (!activeBoardId) return
    try {
      await api.restoreCard(card.id)
      await Promise.all([loadCards(activeBoardId), loadArchivedCards(activeBoardId), refreshBoards()])
      setError(null)
    } catch (e) { onApiError(e) }
  }

  async function deleteArchivedCard(card) {
    if (!activeBoardId) return
    try {
      await api.remove(card.id)
      setArchivedCards((current) => current.filter((candidate) => candidate.id !== card.id))
      await refreshBoards()
      setError(null)
    } catch (e) { onApiError(e) }
  }
  function addCard(status = 'todo', category = 'general') {
    if (!activeBoardId) return
    if (status === 'progress' && progressAtLimit) {
      setError(progressLimitMessage())
      return
    }
    const createdAt = Date.now()
    const nc = {
      id: uid(),
      board_id: activeBoardId,
      title: 'New task',
      category,
      phase: '',
      details: '',
      contact: '',
      status,
      comments: [],
      researchRuns: [],
      documents: [],
      subtasks: [],
      createdAt,
      statusChangedAt: createdAt,
    }
    setCards((cs) => [...cs, nc])
    setOpenId(nc.id)
    api.create(nc)
      .then((created) => {
        setCards((cs) => cs.map((card) => card.id === nc.id ? created : card))
        refreshBoards()
      })
      .catch(onApiError)
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
  // Replace a card's subtasks and recompute the counters the tiles read from.
  function withSubtasks(card, subtasks) {
    return { ...card, subtasks, ...subtaskSummary(subtasks) }
  }
  async function addSubtask(cardId, title) {
    const subtask = await api.addSubtask(cardId, title)
    setCards((cs) => cs.map((card) => (
      card.id === cardId ? withSubtasks(card, [...(card.subtasks || []), subtask]) : card
    )))
    return subtask
  }
  async function updateSubtask(subtaskId, patch) {
    let updated
    try {
      updated = await api.updateSubtask(subtaskId, patch)
    } catch (e) {
      onApiError(e)
      return null
    }
    setCards((cs) => cs.map((card) => (
      (card.subtasks || []).some((s) => s.id === subtaskId)
        ? withSubtasks(card, card.subtasks.map((s) => (s.id === subtaskId ? updated : s)))
        : card
    )))
    return updated
  }
  function deleteSubtask(cardId, subtaskId) {
    setCards((cs) => cs.map((card) => (
      card.id === cardId
        ? withSubtasks(card, (card.subtasks || []).filter((s) => s.id !== subtaskId))
        : card
    )))
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
  async function storeBoard(action) {
    const board = boardModal?.board
    if (!board) return
    try {
      if (action === 'archived') await api.archiveBoard(board.id)
      else await api.trashBoard(board.id)
      const rest = boards.filter((candidate) => candidate.id !== board.id)
      setBoards(rest)
      setBoardModal(null)
      if (activeBoardId === board.id && rest[0]) selectBoard(rest[0].id)
      setStoredBoards(await api.listStoredBoards())
      setBoardUndo({ id: board.id, name: board.name, action })
      setError(null)
    } catch (e) { onApiError(e) }
  }

  async function undoBoardStorage() {
    if (!boardUndo) return
    const board = boardUndo
    setBoardUndo(null)
    try {
      await api.restoreBoard(board.id)
      const active = await refreshBoardLists()
      if (active?.some((candidate) => candidate.id === board.id)) selectBoard(board.id)
      setError(null)
    } catch (e) { onApiError(e) }
  }

  async function restoreBoard(board) {
    try {
      await api.restoreBoard(board.id)
      const active = await refreshBoardLists()
      setStorageOpen(false)
      if (active?.some((candidate) => candidate.id === board.id)) selectBoard(board.id)
      setError(null)
    } catch (e) { onApiError(e) }
  }

  async function deleteBoardPermanently(board) {
    try {
      await api.removeBoardPermanently(board.id)
      setStoredBoards((current) => current.filter((candidate) => candidate.id !== board.id))
      setError(null)
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
      // Firefox only starts the download for a link that is in the document, and
      // it needs the object URL to outlive the click.
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (error) {
      onApiError(error)
    }
  }
  function importJson(e) {
    const file = e.target.files?.[0]
    if (!file || !activeBoardId) return
    const reader = new FileReader()
    reader.onerror = () => alert('The file could not be read.')
    reader.onload = async () => {
      let data
      try {
        data = JSON.parse(reader.result)
      } catch (err) {
        console.error(err)
        return alert('This file is not valid JSON.')
      }
      if (!Array.isArray(data)) return alert('Invalid backup format.')
      if (!confirm(`Replace all cards in “${activeBoard?.name || 'this board'}” with ${data.length} imported cards?`)) return
      try {
        setCards(await api.importBoard(activeBoardId, data))
        refreshBoards()
      } catch (err) {
        console.error(err)
        alert(err?.message || 'The backup could not be imported.')
      }
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
        <button
          type="button"
          className="board-storage"
          data-action="board-storage"
          onClick={() => setStorageOpen(true)}
          aria-label={`Open board storage. ${storedBoards.length} stored ${storedBoards.length === 1 ? 'board' : 'boards'}.`}
        >
          <span aria-hidden="true">Archive</span>
          {storedBoards.length > 0 && <span className="board-storage-count" aria-hidden="true">{storedBoards.length}</span>}
        </button>
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
          <button
            type="button"
            className="btn ghost"
            data-action="task-archive"
            onClick={() => {
              setCardArchiveOpen(true)
              if (activeBoardId) loadArchivedCards(activeBoardId)
            }}
          >
            Task archive{activeBoard?.archivedCount ? ` (${activeBoard.archivedCount})` : ''}
          </button>
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

      {undo && (
        <div className="banner undo" role="status">
          <span className="undo-text">
            Moved “{undo.title}” to {laneLabel(undo.to)}.
          </span>
          <button type="button" className="btn tiny" onClick={undoMove}>Undo</button>
          <button type="button" className="banner-dismiss" onClick={() => setUndo(null)} aria-label="Dismiss">✕</button>
        </div>
      )}

      {boardUndo && (
        <div className="banner undo" role="status">
          <span className="undo-text">
            {boardUndo.action === 'archived'
              ? `Archived “${boardUndo.name}”.`
              : `Moved “${boardUndo.name}” to trash.`}
          </span>
          <button type="button" className="btn tiny" onClick={undoBoardStorage}>Undo</button>
          <button type="button" className="banner-dismiss" onClick={() => setBoardUndo(null)} aria-label="Dismiss">✕</button>
        </div>
      )}

      {cardArchiveUndo && (
        <div className="banner undo" role="status">
          <span className="undo-text">Archived “{cardArchiveUndo.title}”.</span>
          <button type="button" className="btn tiny" onClick={undoCardArchive}>Undo</button>
          <button type="button" className="banner-dismiss" onClick={() => setCardArchiveUndo(null)} aria-label="Dismiss">✕</button>
        </div>
      )}

      {/* Status metrics */}
      <section className="dashboard" aria-label="Board status">
        <StatTile label="To Do" value={stats.todo} tone="muted" />
        <StatTile label="In Progress" value={stats.progress} sub={progressLimit !== null ? `/ ${progressLimit}` : undefined} tone="accent" />
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
          {LANES.map((col) => (
            <BoardColumn
              key={col.id}
              col={col}
              groups={categoryGroups}
              collapsed={collapsed}
              onToggle={(key) => toggleGroup(col.id, key)}
              dragOver={dragOverCol === col.id}
              onDragOver={() => setDragOverCol(col.id)}
              onDragLeave={() => setDragOverCol((v) => (v === col.id ? null : v))}
              onDrop={() => onDrop(col.id)}
              onOpen={setOpenId}
              onDragStart={setDragId}
              onDragEnd={() => { setDragId(null); setDragOverCol(null) }}
              onMove={moveCard}
              onAddCard={() => addCard(col.id)}
              progressLimit={col.id === 'progress' ? progressLimit : null}
              progressAtLimit={col.id === 'progress' && progressAtLimit}
              dropBlocked={Boolean(
                dragId
                && col.id === 'progress'
                && progressAtLimit
                && cards.find((card) => card.id === dragId)?.status !== 'progress'
              )}
              showLaneAge={Boolean(activeBoard?.show_lane_age)}
              now={clockNow}
            />
          ))}
        </main>
      )}

      {openCard && (
        <CardModal
          card={openCard}
          onClose={() => setOpenId(null)}
          onUpdate={(patch) => updateCard(openCard.id, patch)}
          onArchive={() => archiveCard(openCard.id)}
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
          canStore={boards.length > 1}
          onClose={() => setBoardModal(null)}
          onSave={saveBoard}
          onArchive={() => storeBoard('archived')}
          onTrash={() => storeBoard('trashed')}
          progressCount={boardModal.board?.id === activeBoardId
            ? stats.progress
            : (boardModal.board?.progressCount || 0)}
        />
      )}

      {storageOpen && (
        <BoardStorageModal
          boards={storedBoards}
          onClose={() => setStorageOpen(false)}
          onRestore={restoreBoard}
          onDeletePermanently={deleteBoardPermanently}
        />
      )}

      {cardArchiveOpen && (
        <CardArchiveModal
          cards={archivedCards}
          onClose={() => setCardArchiveOpen(false)}
          onRestore={restoreCard}
          onDeletePermanently={deleteArchivedCard}
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

function BoardColumn({
  col,
  groups,
  collapsed,
  onToggle,
  dragOver,
  onDragOver,
  onDragLeave,
  onDrop,
  onOpen,
  onDragStart,
  onDragEnd,
  onMove,
  onAddCard,
  progressLimit,
  progressAtLimit,
  dropBlocked,
  showLaneAge,
  now,
}) {
  const headingId = `column-${col.id}`
  // Cards grouped by category, keeping only categories that have a card in this lane.
  const lanes = groups
    .map((group) => ({ group, cards: group.cards.filter((c) => c.status === col.id) }))
    .filter((lane) => lane.cards.length > 0)
  const total = lanes.reduce((sum, lane) => sum + lane.cards.length, 0)

  return (
    <section
      className={`column ${dragOver ? 'dragover' : ''} ${progressAtLimit ? 'limit-reached' : ''}`}
      aria-labelledby={headingId}
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = dropBlocked ? 'none' : 'move'
        if (dropBlocked) onDragLeave()
        else onDragOver()
      }}
      onDragLeave={onDragLeave}
      onDrop={(e) => { e.preventDefault(); onDrop() }}
    >
      <div className="column-head">
        <h2 id={headingId}>{col.title}</h2>
        <span
          className="count"
          aria-label={progressLimit === null
            ? `${total} ${total === 1 ? 'task' : 'tasks'}`
            : `${total} of ${progressLimit} allowed tasks`}
        >
          {total}{progressLimit !== null && ` / ${progressLimit}`}
        </span>
      </div>
      <div className="column-body">
        {lanes.map(({ group, cards }) => {
          const key = group.key
          const label = key === '__none' ? 'Uncategorized' : (CATEGORIES[key]?.label || key)
          const color = CATEGORIES[key]?.color || '#888'
          const isCollapsed = collapsed.has(`${col.id}::${key}`)
          const panelId = `group-${col.id}-${key}`
          return (
            <div key={key} className={`cat-group ${isCollapsed ? 'collapsed' : ''}`} style={{ '--cat': color }}>
              <button
                type="button"
                className="cat-group-head"
                onClick={() => onToggle(key)}
                aria-expanded={!isCollapsed}
                aria-controls={panelId}
                aria-label={`${label}, ${cards.length} ${cards.length === 1 ? 'task' : 'tasks'}, ${col.title}`}
              >
                <span className="cat-caret" aria-hidden="true">{isCollapsed ? '▸' : '▾'}</span>
                <span className="cat-dot" aria-hidden="true" />
                <span className="cat-name">{label}</span>
                <span className="cat-count" aria-hidden="true">{cards.length}</span>
              </button>
              {!isCollapsed && (
                <div className="cat-cards" id={panelId}>
                  {cards.map((card) => (
                    <CardTile
                      key={card.id}
                      card={card}
                      onOpen={() => onOpen(card.id)}
                      onDragStart={() => onDragStart(card.id)}
                      onDragEnd={onDragEnd}
                      onMove={(status) => onMove(card.id, status)}
                      progressEntryBlocked={progressAtLimit}
                      showLaneAge={showLaneAge}
                      now={now}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}
        {total === 0 && <div className="empty">No tasks here</div>}
      </div>
      <button
        type="button"
        className="addcard"
        onClick={onAddCard}
        disabled={progressAtLimit}
        title={progressAtLimit ? `In Progress limit (${progressLimit}) reached` : undefined}
      >
        {progressAtLimit ? 'In Progress limit reached' : '+ Add task'}
      </button>
    </section>
  )
}

function CardTile({ card, onOpen, onDragStart, onDragEnd, onMove, progressEntryBlocked, showLaneAge, now }) {
  const cat = CATEGORIES[card.category] || { label: card.category, color: '#888' }
  const phase = PHASES[card.phase]
  const nextStatus = card.status === 'todo' ? 'progress' : card.status === 'progress' ? 'done' : null
  const prevStatus = card.status === 'done' ? 'progress' : card.status === 'progress' ? 'todo' : null

  const [expanded, setExpanded] = useState(false)
  const [subtasksOpen, setSubtasksOpen] = useState(false)
  const detailId = useId()
  const subtaskListId = useId()
  const subtasks = card.subtasks || []
  const hasDetail = Boolean(card.details) || subtasks.length > 0
  const doneBlocked = nextStatus === 'done' && !isDoneMoveAllowed(card)
  const progressBlocked = nextStatus === 'progress' && progressEntryBlocked
  const forwardBlocked = doneBlocked || progressBlocked

  return (
    <article
      className="card"
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      style={{ '--cat': cat.color }}
    >
      <div className={`card-head ${hasDetail ? '' : 'no-caret'}`}>
        {hasDetail && (
          <button
            type="button"
            className="card-caret"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-controls={detailId}
            aria-label={expanded ? `Collapse ${card.title}` : `Expand ${card.title}`}
          >
            {expanded ? '▾' : '▸'}
          </button>
        )}
        <button type="button" className="card-open" onClick={onOpen} aria-label={`Open task: ${card.title}`}>
          <span className="card-tags">
            {card.category && <span className="tag cat">{cat.label}</span>}
            {phase && <span className="tag phase" style={{ '--ph': phase.color }}>{phase.label}</span>}
          </span>
          <span className="card-title" role="heading" aria-level="3">{card.title}</span>
          {card.contact && <span className="card-contact">{card.contact}</span>}
        </button>
      </div>

      {expanded && hasDetail && (
        <div className="card-detail" id={detailId}>
          {card.details
            ? <p className="card-detail-text">{card.details}</p>
            : <p className="card-detail-empty">No details yet.</p>}
          {subtasks.length > 0 && (
            <div className="card-subtasks">
              <button
                type="button"
                className="subtasks-toggle"
                onClick={() => setSubtasksOpen((v) => !v)}
                aria-expanded={subtasksOpen}
                aria-controls={subtaskListId}
              >
                <span aria-hidden="true">{subtasksOpen ? '▾' : '▸'}</span>
                <span>Subtasks</span>
                <span className="count">{card.doneCount}/{card.subtaskCount}</span>
              </button>
              {subtasksOpen && (
                <ul className="card-subtask-list" id={subtaskListId}>
                  {subtasks.map((s) => (
                    <li key={s.id} className={`card-subtask-row subtask-${s.status}`}>
                      <span className="card-subtask-icon" aria-hidden="true">
                        {(SUBTASK_STATUSES[s.status] || '○').split(' ')[0]}
                      </span>
                      <span className="card-subtask-title">{s.title}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
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
          {showLaneAge && (
            <span
              className="chip lane-age-chip"
              aria-label={`In this column for ${formatLaneAge(card.statusChangedAt || card.createdAt, now)}`}
              title={`Entered this column ${new Date(card.statusChangedAt || card.createdAt).toLocaleString()}`}
            >
              ◷ {formatLaneAge(card.statusChangedAt || card.createdAt, now)}
            </span>
          )}
        </div>
        <div className="movebtns">
          {prevStatus && (
            <button
              type="button"
              title={prevStatus === 'progress' && progressEntryBlocked ? 'In Progress limit reached' : 'Move back'}
              aria-label={`Move ${card.title} to ${LANE_LABELS[prevStatus]}`}
              onClick={() => onMove(prevStatus)}
              disabled={prevStatus === 'progress' && progressEntryBlocked}
            >◀</button>
          )}
          {nextStatus && (
            <button
              type="button"
              title={doneBlocked
                ? 'Finish or mark all subtasks first'
                : progressBlocked ? 'In Progress limit reached' : 'Move forward'}
              aria-label={`Move ${card.title} to ${LANE_LABELS[nextStatus]}`}
              onClick={() => onMove(nextStatus)}
              disabled={forwardBlocked}
            >▶</button>
          )}
        </div>
      </div>
    </article>
  )
}
