// Plainlane API: SQLite persistence and optional server-side web research.
import express from 'express'
import Database from 'better-sqlite3'
import { fileURLToPath } from 'url'
import { loadEnvFile } from 'node:process'
import path from 'path'
import { SEED_CARDS } from '../src/seed.js'
import { subtasksResolved } from '../src/subtasks.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ENV_PATH = path.join(__dirname, '..', '.env')

try {
  loadEnvFile(ENV_PATH)
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}

const DB_PATH = process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : path.join(__dirname, 'plainlane.db')
const PORT = process.env.PORT || 3001
const HOST = process.env.HOST || '127.0.0.1'
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.6'

const DEFAULT_BOARD = {
  id: 'board-getting-started',
  name: 'Getting started',
  emoji: '👋',
  accent: '#4f46e5',
  kind: 'generic',
  subtask_limit: 10,
  progress_limit: null,
  show_lane_age: 0,
}

const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS boards (
    id        TEXT PRIMARY KEY,
    name      TEXT NOT NULL,
    emoji     TEXT,
    accent    TEXT,
    kind      TEXT NOT NULL DEFAULT 'generic',
    ord       INTEGER NOT NULL DEFAULT 0,
    createdAt INTEGER NOT NULL,
    subtask_limit INTEGER NOT NULL DEFAULT 10,
    progress_limit INTEGER DEFAULT NULL,
    show_lane_age INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS cards (
    id        TEXT PRIMARY KEY,
    title     TEXT NOT NULL,
    category  TEXT,
    phase     TEXT,
    details   TEXT,
    contact   TEXT,
    status    TEXT NOT NULL DEFAULT 'todo',
    ord       INTEGER NOT NULL DEFAULT 0,
    createdAt INTEGER,
    status_changed_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS subtasks (
    id        TEXT PRIMARY KEY,
    card_id   TEXT NOT NULL,
    title     TEXT NOT NULL,
    status    TEXT NOT NULL DEFAULT 'todo',
    ord       INTEGER NOT NULL DEFAULT 0,
    createdAt INTEGER NOT NULL,
    FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS comments (
    id      TEXT PRIMARY KEY,
    card_id TEXT NOT NULL,
    text    TEXT NOT NULL,
    ts      INTEGER NOT NULL,
    FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS research_runs (
    id        TEXT PRIMARY KEY,
    card_id   TEXT NOT NULL,
    question  TEXT NOT NULL,
    summary   TEXT NOT NULL,
    model     TEXT,
    createdAt INTEGER NOT NULL,
    FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS research_sources (
    id          TEXT PRIMARY KEY,
    research_id TEXT NOT NULL,
    url         TEXT NOT NULL,
    title       TEXT,
    start_index INTEGER NOT NULL DEFAULT -1,
    end_index   INTEGER NOT NULL DEFAULT -1,
    is_citation INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (research_id) REFERENCES research_runs(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS documents (
    id        TEXT PRIMARY KEY,
    card_id   TEXT NOT NULL,
    filename  TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size      INTEGER NOT NULL,
    kind      TEXT NOT NULL DEFAULT 'other',
    status    TEXT NOT NULL DEFAULT 'open',
    note      TEXT,
    data      BLOB NOT NULL,
    createdAt INTEGER NOT NULL,
    FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
  );
`)

// Additive schema migration for databases created by earlier versions.
const cardColumns = db.prepare('PRAGMA table_info(cards)').all().map((c) => c.name)
if (!cardColumns.includes('board_id')) db.exec('ALTER TABLE cards ADD COLUMN board_id TEXT')
if (!cardColumns.includes('status_changed_at')) db.exec('ALTER TABLE cards ADD COLUMN status_changed_at INTEGER')
db.prepare('UPDATE cards SET status_changed_at = ? WHERE status_changed_at IS NULL').run(Date.now())

const boardColumns = db.prepare('PRAGMA table_info(boards)').all().map((c) => c.name)
if (!boardColumns.includes('subtask_limit')) db.exec('ALTER TABLE boards ADD COLUMN subtask_limit INTEGER NOT NULL DEFAULT 10')
if (!boardColumns.includes('progress_limit')) db.exec('ALTER TABLE boards ADD COLUMN progress_limit INTEGER DEFAULT NULL')
if (!boardColumns.includes('show_lane_age')) db.exec('ALTER TABLE boards ADD COLUMN show_lane_age INTEGER NOT NULL DEFAULT 0')

// ---------- Prepared statements ----------
const stmt = {
  allBoards: db.prepare('SELECT * FROM boards ORDER BY ord ASC, createdAt ASC'),
  oneBoard: db.prepare('SELECT * FROM boards WHERE id = ?'),
  insBoard: db.prepare(
    `INSERT INTO boards
      (id, name, emoji, accent, kind, ord, createdAt, subtask_limit, progress_limit, show_lane_age)
     VALUES
      (@id, @name, @emoji, @accent, @kind, @ord, @createdAt, @subtask_limit, @progress_limit, @show_lane_age)`
  ),
  delBoard: db.prepare('DELETE FROM boards WHERE id = ?'),
  maxBoardOrd: db.prepare('SELECT COALESCE(MAX(ord), -1) AS m FROM boards'),
  countBoards: db.prepare('SELECT COUNT(*) AS n FROM boards'),
  boardCounts: db.prepare(
    `SELECT board_id, COUNT(*) AS total,
            SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done,
            SUM(CASE WHEN status = 'progress' THEN 1 ELSE 0 END) AS progress
     FROM cards GROUP BY board_id`
  ),

  cardsByBoard: db.prepare(
    `SELECT id, board_id, title, category, phase, details, contact, status, ord, createdAt,
            status_changed_at AS statusChangedAt
     FROM cards WHERE board_id = ? ORDER BY ord ASC, createdAt ASC`
  ),
  oneCard: db.prepare(
    `SELECT id, board_id, title, category, phase, details, contact, status, ord, createdAt,
            status_changed_at AS statusChangedAt
     FROM cards WHERE id = ?`
  ),
  cardComments: db.prepare('SELECT id, text, ts FROM comments WHERE card_id = ? ORDER BY ts ASC'),
  cardResearch: db.prepare(
    'SELECT id, question, summary, model, createdAt FROM research_runs WHERE card_id = ? ORDER BY createdAt DESC'
  ),
  oneResearch: db.prepare(
    'SELECT id, question, summary, model, createdAt FROM research_runs WHERE id = ?'
  ),
  researchSources: db.prepare(
    `SELECT id, url, title, start_index AS startIndex, end_index AS endIndex,
            is_citation AS isCitation FROM research_sources WHERE research_id = ? ORDER BY rowid ASC`
  ),
  cardDocuments: db.prepare(
    `SELECT id, filename, mime_type AS mimeType, size, kind, status, note, createdAt
     FROM documents WHERE card_id = ? ORDER BY createdAt DESC`
  ),
  cardDocumentsFull: db.prepare(
    `SELECT id, filename, mime_type AS mimeType, size, kind, status, note, data, createdAt
     FROM documents WHERE card_id = ? ORDER BY createdAt DESC`
  ),
  oneDocument: db.prepare(
    `SELECT id, card_id, filename, mime_type AS mimeType, size, kind, status, note, data, createdAt
     FROM documents WHERE id = ?`
  ),
  maxOrd: db.prepare('SELECT COALESCE(MAX(ord), -1) AS m FROM cards WHERE board_id = ?'),
  insCard: db.prepare(
    `INSERT INTO cards
      (id, board_id, title, category, phase, details, contact, status, ord, createdAt, status_changed_at)
     VALUES
      (@id, @board_id, @title, @category, @phase, @details, @contact, @status, @ord, @createdAt, @status_changed_at)`
  ),
  delCard: db.prepare('DELETE FROM cards WHERE id = ?'),
  delCardsByBoard: db.prepare('DELETE FROM cards WHERE board_id = ?'),

  cardSubtasks: db.prepare('SELECT id, title, status, ord, createdAt FROM subtasks WHERE card_id = ? ORDER BY ord ASC, createdAt ASC'),
  oneSubtask: db.prepare('SELECT id, title, status, ord, createdAt FROM subtasks WHERE id = ?'),
  insSubtask: db.prepare(
    `INSERT INTO subtasks (id, card_id, title, status, ord, createdAt)
     VALUES (@id, @card_id, @title, @status, @ord, @createdAt)`
  ),
  delSubtask: db.prepare('DELETE FROM subtasks WHERE id = ?'),

  insComment: db.prepare('INSERT INTO comments (id, card_id, text, ts) VALUES (@id, @card_id, @text, @ts)'),
  delComment: db.prepare('DELETE FROM comments WHERE id = ?'),
  insResearch: db.prepare(
    `INSERT INTO research_runs (id, card_id, question, summary, model, createdAt)
     VALUES (@id, @card_id, @question, @summary, @model, @createdAt)`
  ),
  insSource: db.prepare(
    `INSERT INTO research_sources
      (id, research_id, url, title, start_index, end_index, is_citation)
     VALUES (@id, @research_id, @url, @title, @start_index, @end_index, @is_citation)`
  ),
  delResearch: db.prepare('DELETE FROM research_runs WHERE id = ?'),
  insDocument: db.prepare(
    `INSERT INTO documents (id, card_id, filename, mime_type, size, kind, status, note, data, createdAt)
     VALUES (@id, @card_id, @filename, @mime_type, @size, @kind, @status, @note, @data, @createdAt)`
  ),
  delDocument: db.prepare('DELETE FROM documents WHERE id = ?'),
  progressCount: db.prepare("SELECT COUNT(*) AS n FROM cards WHERE board_id = ? AND status = 'progress'"),
  count: db.prepare('SELECT COUNT(*) AS n FROM cards'),
}

const UPDATABLE = ['title', 'category', 'phase', 'details', 'contact', 'status', 'ord', 'board_id']

function ensureDefaultBoard() {
  if (!stmt.oneBoard.get(DEFAULT_BOARD.id)) {
    stmt.insBoard.run({ ...DEFAULT_BOARD, ord: 0, createdAt: Date.now() })
  }
}

function ensureInitialBoard() {
  const existingBoard = stmt.allBoards.all()[0]
  if (existingBoard) return existingBoard
  ensureDefaultBoard()
  return stmt.oneBoard.get(DEFAULT_BOARD.id)
}

function hydrateResearch(run) {
  return { ...run, sources: stmt.researchSources.all(run.id) }
}

function hydrateCard(row) {
  if (!row) return null
  const subtasks = stmt.cardSubtasks.all(row.id)
  const finalStatuses = new Set(['done', 'wont_do', 'old', 'question'])
  const doneCount = subtasks.filter(s => s.status === 'done').length
  const finalCount = subtasks.filter(s => finalStatuses.has(s.status)).length
  const completionPct = subtasks.length > 0 ? Math.round((finalCount / subtasks.length) * 100) : 100

  const latestSubtaskTime = subtasks.length > 0 ? Math.max(...subtasks.map(s => s.createdAt)) : row.createdAt
  const updatedAt = Math.max(row.createdAt || 0, row.statusChangedAt || 0, latestSubtaskTime || 0)

  return {
    ...row,
    comments: stmt.cardComments.all(row.id),
    researchRuns: stmt.cardResearch.all(row.id).map(hydrateResearch),
    documents: stmt.cardDocuments.all(row.id),
    subtasks,
    completionPct,
    doneCount,
    subtaskCount: subtasks.length,
    updatedAt,
  }
}

function listCards(boardId) {
  return stmt.cardsByBoard.all(boardId).map(hydrateCard)
}

function listBoards() {
  const counts = {}
  for (const row of stmt.boardCounts.all()) {
    counts[row.board_id] = { total: row.total, done: row.done || 0, progress: row.progress || 0 }
  }
  return stmt.allBoards.all().map((board) => {
    const c = counts[board.id] || { total: 0, done: 0, progress: 0 }
    return {
      ...board,
      cardCount: c.total,
      doneCount: c.done,
      progressCount: c.progress,
      openCount: c.total - c.done,
    }
  })
}

function parseProgressLimit(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null
  const limit = Number(value)
  if (!Number.isInteger(limit) || limit < 1 || limit > 999) {
    const error = new Error('In Progress limit must be empty or a whole number from 1 to 999.')
    error.status = 400
    throw error
  }
  return limit
}

function toSqliteBoolean(value) {
  return value === true || value === 1 || value === '1' ? 1 : 0
}

function progressLimitError(limit) {
  const error = new Error(`In Progress limit (${limit}) reached for this board.`)
  error.status = 409
  return error
}

function ensureProgressCapacity(boardId) {
  const board = stmt.oneBoard.get(boardId)
  if (!board) {
    const error = new Error('Unknown board.')
    error.status = 400
    throw error
  }
  if (board.progress_limit !== null && stmt.progressCount.get(boardId).n >= board.progress_limit) {
    throw progressLimitError(board.progress_limit)
  }
  return board
}

function insertResearch(cardId, run) {
  const researchId = String(run.id || `r-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`)
  stmt.insResearch.run({
    id: researchId,
    card_id: cardId,
    question: run.question || 'Imported research',
    summary: run.summary || '',
    model: run.model || null,
    createdAt: run.createdAt || Date.now(),
  })
  ;(run.sources || []).forEach((source, index) => {
    const url = cleanWebUrl(source?.url)
    if (!url) return
    stmt.insSource.run({
      id: String(source.id || `${researchId}-s-${index}`),
      research_id: researchId,
      url,
      title: source.title || url,
      start_index: Number.isInteger(source.startIndex) ? source.startIndex : -1,
      end_index: Number.isInteger(source.endIndex) ? source.endIndex : -1,
      is_citation: source.isCitation ? 1 : 0,
    })
  })
}

const DOCUMENT_MIME_BY_EXTENSION = {
  '.pdf': 'application/pdf',
  '.eml': 'message/rfc822',
  '.msg': 'application/vnd.ms-outlook',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.txt': 'text/plain',
}
const DOCUMENT_KINDS = new Set(['form', 'email', 'contract', 'proof', 'other'])
const DOCUMENT_STATUSES = new Set(['open', 'in_progress', 'ready_to_sign', 'sent', 'confirmed', 'archived'])
const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024

function documentMetadata(row) {
  if (!row) return null
  const { data: _data, card_id: _cardId, ...metadata } = row
  return metadata
}

function prepareDocument(payload) {
  const filename = path.basename(String(payload?.filename || '')).replace(/[\r\n]/g, '').slice(0, 180)
  const extension = path.extname(filename).toLowerCase()
  const mimeType = DOCUMENT_MIME_BY_EXTENSION[extension]
  if (!filename || !mimeType) {
    const error = new Error('Allowed file types: PDF, email files, images, DOC, DOCX, ODT, and TXT.')
    error.status = 400
    throw error
  }
  const encoded = String(payload?.dataBase64 || '').replace(/^data:[^;]+;base64,/, '')
  const data = Buffer.from(encoded, 'base64')
  if (!data.length) {
    const error = new Error('The file is empty or could not be read.')
    error.status = 400
    throw error
  }
  if (data.length > MAX_DOCUMENT_BYTES) {
    const error = new Error('The file is larger than 15 MB.')
    error.status = 413
    throw error
  }
  return {
    filename,
    mimeType,
    data,
    kind: DOCUMENT_KINDS.has(payload.kind) ? payload.kind : 'other',
    status: DOCUMENT_STATUSES.has(payload.status) ? payload.status : 'open',
    note: String(payload.note || '').trim().slice(0, 1000),
  }
}

function insertDocument(cardId, payload) {
  if (!payload?.dataBase64) return null
  const prepared = prepareDocument(payload)
  const id = String(payload.id || `d-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`)
  stmt.insDocument.run({
    id,
    card_id: cardId,
    filename: prepared.filename,
    mime_type: prepared.mimeType,
    size: prepared.data.length,
    kind: prepared.kind,
    status: prepared.status,
    note: prepared.note,
    data: prepared.data,
    createdAt: payload.createdAt || Date.now(),
  })
  return documentMetadata(stmt.oneDocument.get(id))
}

function exportCards(boardId) {
  return stmt.cardsByBoard.all(boardId).map((row) => {
    const card = hydrateCard(row)
    card.documents = stmt.cardDocumentsFull.all(row.id).map((document) => ({
      ...documentMetadata(document),
      dataBase64: document.data.toString('base64'),
    }))
    // Subtasks are already included by hydrateCard
    return card
  })
}

// Replace every card on a board with the supplied list (seed and import).
const importIntoBoard = db.transaction((boardId, cards) => {
  stmt.delCardsByBoard.run(boardId)
  cards.forEach((card, index) => {
    const cardId = String(card.id)
    stmt.insCard.run({
      id: cardId,
      board_id: boardId,
      title: card.title || 'Untitled task',
      category: card.category || null,
      phase: card.phase || null,
      details: card.details || '',
      contact: card.contact || '',
      status: card.status || 'todo',
      ord: Number.isFinite(card.ord) ? card.ord : index,
      createdAt: card.createdAt || Date.now(),
      status_changed_at: card.statusChangedAt || card.createdAt || Date.now(),
    })
    ;(card.comments || []).forEach((comment) =>
      stmt.insComment.run({
        id: String(comment.id),
        card_id: cardId,
        text: comment.text,
        ts: comment.ts || Date.now(),
      })
    )
    ;(card.subtasks || []).forEach((subtask) =>
      stmt.insSubtask.run({
        id: String(subtask.id || `s-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`),
        card_id: cardId,
        title: subtask.title || 'Unnamed subtask',
        status: subtask.status || 'todo',
        ord: Number.isFinite(subtask.ord) ? subtask.ord : undefined,
        createdAt: subtask.createdAt || Date.now(),
      })
    )
    ;(card.researchRuns || []).forEach((run) => insertResearch(cardId, run))
    ;(card.documents || []).forEach((document) => insertDocument(cardId, document))
  })
})

// Keep existing boards intact. Create the starter board only for a database
// without boards, then attach cards from older single-board databases to it.
const initialBoard = ensureInitialBoard()
db.prepare('UPDATE cards SET board_id = ? WHERE board_id IS NULL').run(initialBoard.id)

// Seed only a completely empty database.
if (stmt.count.get().n === 0) {
  importIntoBoard(initialBoard.id, SEED_CARDS)
  console.log(`[db] Created ${SEED_CARDS.length} starter cards.`)
}

function cleanWebUrl(value) {
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null
  } catch {
    return null
  }
}

function extractResearch(response) {
  let summary = ''
  const sources = []

  for (const item of response.output || []) {
    if (item.type === 'web_search_call') {
      for (const source of item.action?.sources || []) {
        const url = cleanWebUrl(source.url)
        if (!url) continue
        sources.push({
          url,
          title: source.title || url,
          startIndex: -1,
          endIndex: -1,
          isCitation: false,
        })
      }
    }
    if (item.type !== 'message') continue
    for (const part of item.content || []) {
      if (part.type !== 'output_text' || !part.text) continue
      if (summary) summary += '\n'
      const offset = summary.length
      summary += part.text
      for (const citation of part.annotations || []) {
        const url = cleanWebUrl(citation.url)
        if (citation.type !== 'url_citation' || !url) continue
        sources.push({
          url,
          title: citation.title || url,
          startIndex: offset + citation.start_index,
          endIndex: offset + citation.end_index,
          isCitation: true,
        })
      }
    }
  }

  if (!summary && response.output_text) summary = response.output_text
  if (!summary) throw new Error('The AI response did not contain text.')

  const unique = new Map()
  for (const source of sources) {
    const key = `${source.url}|${source.startIndex}|${source.endIndex}`
    if (!unique.has(key)) unique.set(key, source)
  }
  return { summary, sources: [...unique.values()] }
}

async function runWebResearch(card, board, question) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    const error = new Error('OPENAI_API_KEY is missing. Add it to the local .env file.')
    error.status = 503
    throw error
  }

  const today = new Date().toISOString().slice(0, 10)
  const input = [
    `You are researching a task on a project board named “${String(board?.name || 'General').slice(0, 200)}”.`,
    `Current date: ${today}.`,
    `Task: ${String(card.title || '').slice(0, 500)}`,
    `Existing details: ${String(card.details || 'None').slice(0, 6000)}`,
    `Research request: ${String(question || '').slice(0, 1200)}`,
    '',
    'Use web search. Prefer current, official, and reliable sources.',
    'Answer in clear, concise English with verified facts, useful next steps, and unresolved questions.',
    'Cite time-sensitive, legal, or otherwise important claims. Never invent contract, account, or identity data.',
  ].join('\n')

  const searchTool = { type: 'web_search', search_context_size: 'medium' }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 120_000)
  let response
  try {
    response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        reasoning: { effort: 'low' },
        tools: [searchTool],
        tool_choice: 'required',
        include: ['web_search_call.action.sources'],
        store: false,
        safety_identifier: 'plainlane-local-user',
        input,
      }),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(payload.error?.message || `OpenAI request failed (HTTP ${response.status}).`)
    error.status = response.status >= 500 ? 502 : 400
    throw error
  }

  return { ...extractResearch(payload), model: payload.model || OPENAI_MODEL }
}

const saveResearch = db.transaction((cardId, question, result) => {
  const id = `r-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  insertResearch(cardId, {
    id,
    question,
    summary: result.summary,
    model: result.model,
    createdAt: Date.now(),
    sources: result.sources,
  })
  return hydrateResearch(stmt.oneResearch.get(id))
})

const rndId = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

// ---------- API ----------
const app = express()
app.use(express.json({ limit: '100mb' }))

app.get('/api/health', (_req, res) => res.json({ ok: true }))

app.get('/api/ai/status', (_req, res) => {
  res.json({ configured: Boolean(process.env.OPENAI_API_KEY), model: OPENAI_MODEL })
})

// ----- Boards -----
app.get('/api/boards', (_req, res) => res.json(listBoards()))

app.post('/api/boards', (req, res) => {
  const body = req.body || {}
  try {
    const board = {
      id: rndId('board'),
      name: String(body.name || '').trim() || 'New board',
      emoji: (body.emoji || '🗂️').slice(0, 8),
      accent: body.accent || '#4f46e5',
      kind: 'generic',
      ord: stmt.maxBoardOrd.get().m + 1,
      createdAt: Date.now(),
      subtask_limit: Math.max(1, Math.min(10, Number(body.subtask_limit) || 10)),
      progress_limit: parseProgressLimit(body.progress_limit),
      show_lane_age: toSqliteBoolean(body.show_lane_age),
    }
    stmt.insBoard.run(board)
    res.status(201).json({
      ...board,
      cardCount: 0,
      doneCount: 0,
      progressCount: 0,
      openCount: 0,
    })
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message })
  }
})

app.put('/api/boards/:id', (req, res) => {
  const board = stmt.oneBoard.get(req.params.id)
  if (!board) return res.status(404).json({ error: 'Board not found.' })
  const body = req.body || {}
  const allowed = ['name', 'emoji', 'accent', 'ord', 'subtask_limit', 'progress_limit', 'show_lane_age']
  const keys = allowed.filter((key) => key in body)
  try {
    if (keys.length) {
      const setSql = keys.map((key) => `${key} = @${key}`).join(', ')
      const values = { ...body, id: req.params.id }
      if ('subtask_limit' in body) {
        values.subtask_limit = Math.max(1, Math.min(10, Number(body.subtask_limit) || 10))
      }
      if ('progress_limit' in body) {
        values.progress_limit = parseProgressLimit(body.progress_limit)
        const currentCount = stmt.progressCount.get(req.params.id).n
        if (values.progress_limit !== null && values.progress_limit < currentCount) {
          return res.status(409).json({
            error: `In Progress already contains ${currentCount} tasks. Choose a limit of at least ${currentCount}.`,
          })
        }
      }
      if ('show_lane_age' in body) values.show_lane_age = toSqliteBoolean(body.show_lane_age)
      db.prepare(`UPDATE boards SET ${setSql} WHERE id = @id`).run(values)
    }
    res.json(stmt.oneBoard.get(req.params.id))
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message })
  }
})

app.delete('/api/boards/:id', (req, res) => {
  if (stmt.countBoards.get().n <= 1) {
    return res.status(409).json({ error: 'The last board cannot be deleted.' })
  }
  const remove = db.transaction((id) => {
    stmt.delCardsByBoard.run(id)
    stmt.delBoard.run(id)
  })
  remove(req.params.id)
  res.status(204).end()
})

app.get('/api/boards/:id/cards', (req, res) => {
  if (!stmt.oneBoard.get(req.params.id)) return res.status(404).json({ error: 'Board not found.' })
  res.json(listCards(req.params.id))
})

app.get('/api/boards/:id/export', (req, res) => {
  if (!stmt.oneBoard.get(req.params.id)) return res.status(404).json({ error: 'Board not found.' })
  res.json(exportCards(req.params.id))
})

app.post('/api/boards/:id/import', (req, res) => {
  const board = stmt.oneBoard.get(req.params.id)
  if (!board) return res.status(404).json({ error: 'Board not found.' })
  const cards = req.body?.cards
  if (!Array.isArray(cards)) return res.status(400).json({ error: 'Expected { cards: [...] }.' })
  const progressCount = cards.filter((card) => (card.status || 'todo') === 'progress').length
  if (board.progress_limit !== null && progressCount > board.progress_limit) {
    return res.status(409).json({
      error: `Import contains ${progressCount} In Progress tasks, exceeding this board's limit (${board.progress_limit}).`,
    })
  }
  importIntoBoard(req.params.id, cards)
  res.json(listCards(req.params.id))
})

// ----- Cards -----
app.post('/api/cards', (req, res) => {
  const body = req.body || {}
  const boardId = String(body.board_id || DEFAULT_BOARD.id)
  if (!stmt.oneBoard.get(boardId)) return res.status(400).json({ error: 'Unknown board.' })
  const status = body.status || 'todo'
  try {
    if (status === 'progress') ensureProgressCapacity(boardId)
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message })
  }
  const id = String(body.id || rndId('c'))
  const createdAt = body.createdAt || Date.now()
  const card = {
    id,
    board_id: boardId,
    title: body.title || 'New task',
    category: body.category || null,
    phase: body.phase || null,
    details: body.details || '',
    contact: body.contact || '',
    status,
    ord: stmt.maxOrd.get(boardId).m + 1,
    createdAt,
    status_changed_at: createdAt,
  }
  stmt.insCard.run(card)
  res.status(201).json(hydrateCard(stmt.oneCard.get(id)))
})

app.put('/api/cards/:id', (req, res) => {
  const existing = stmt.oneCard.get(req.params.id)
  if (!existing) return res.status(404).json({ error: 'Task not found.' })
  const body = req.body || {}
  const nextBoardId = 'board_id' in body ? String(body.board_id) : existing.board_id
  const nextStatus = 'status' in body ? String(body.status) : existing.status
  const entersProgress = nextStatus === 'progress'
    && (existing.status !== 'progress' || existing.board_id !== nextBoardId)

  try {
    if (!stmt.oneBoard.get(nextBoardId)) {
      return res.status(400).json({ error: 'Unknown board.' })
    }
    if (entersProgress) ensureProgressCapacity(nextBoardId)

    // A task may only enter Done once all of its subtasks have left 'todo'.
    if (nextStatus === 'done' && existing.status !== 'done'
        && !subtasksResolved(stmt.cardSubtasks.all(req.params.id))) {
      return res.status(409).json({ error: 'Finish or mark every subtask before moving this task to Done.' })
    }

    const keys = UPDATABLE.filter((key) => key in body)
    const statusChanged = nextStatus !== existing.status
    if (keys.length || statusChanged) {
      const assignments = keys.map((key) => `${key} = @${key}`)
      const values = { ...body, id: req.params.id }
      if (statusChanged) {
        assignments.push('status_changed_at = @status_changed_at')
        values.status_changed_at = Date.now()
      }
      db.prepare(`UPDATE cards SET ${assignments.join(', ')} WHERE id = @id`).run(values)
    }
    res.json(hydrateCard(stmt.oneCard.get(req.params.id)))
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message })
  }
})

app.delete('/api/cards/:id', (req, res) => {
  stmt.delCard.run(req.params.id)
  res.status(204).end()
})

// ----- Subtasks -----
app.post('/api/cards/:id/subtasks', (req, res) => {
  const card = stmt.oneCard.get(req.params.id)
  if (!card) return res.status(404).json({ error: 'Task not found.' })
  const board = stmt.oneBoard.get(card.board_id)
  const limit = board?.subtask_limit || 10
  const currentCount = stmt.cardSubtasks.all(req.params.id).length
  if (currentCount >= limit) {
    return res.status(409).json({ error: `Subtask limit (${limit}) reached for this board.` })
  }
  const title = String(req.body?.title || '').trim()
  if (!title) return res.status(400).json({ error: 'Subtask title cannot be empty.' })
  const subtaskId = rndId('s')
  const maxSubtaskOrd = stmt.cardSubtasks.all(req.params.id).length
  stmt.insSubtask.run({
    id: subtaskId,
    card_id: req.params.id,
    title,
    status: 'todo',
    ord: maxSubtaskOrd,
    createdAt: Date.now(),
  })
  res.status(201).json(stmt.cardSubtasks.all(req.params.id).find(s => s.id === subtaskId))
})

app.put('/api/subtasks/:id', (req, res) => {
  const existing = stmt.oneSubtask.get(req.params.id)
  if (!existing) return res.status(404).json({ error: 'Subtask not found.' })
  const body = req.body || {}
  const allowed = ['title', 'status', 'ord']
  const keys = allowed.filter((key) => key in body)
  if (keys.length) {
    const setSql = keys.map((key) => `${key} = @${key}`).join(', ')
    const updates = { id: req.params.id }
    if ('title' in body) updates.title = String(body.title || '').trim() || 'Unnamed'
    if ('status' in body) updates.status = String(body.status || 'todo')
    if ('ord' in body) updates.ord = Number(body.ord) || 0
    db.prepare(`UPDATE subtasks SET ${setSql} WHERE id = @id`).run(updates)
  }
  res.json(stmt.oneSubtask.get(req.params.id))
})

app.delete('/api/subtasks/:id', (req, res) => {
  stmt.delSubtask.run(req.params.id)
  res.status(204).end()
})

app.post('/api/cards/:id/comments', (req, res) => {
  const card = stmt.oneCard.get(req.params.id)
  if (!card) return res.status(404).json({ error: 'Task not found.' })
  const text = (req.body?.text || '').trim()
  if (!text) return res.status(400).json({ error: 'The comment is empty.' })
  const comment = { id: rndId('m'), card_id: req.params.id, text, ts: Date.now() }
  stmt.insComment.run(comment)
  res.status(201).json({ id: comment.id, text: comment.text, ts: comment.ts })
})

app.delete('/api/comments/:id', (req, res) => {
  stmt.delComment.run(req.params.id)
  res.status(204).end()
})

// ----- Files and saved emails -----
app.post('/api/cards/:id/documents', (req, res) => {
  const card = stmt.oneCard.get(req.params.id)
  if (!card) return res.status(404).json({ error: 'Task not found.' })
  try {
    res.status(201).json(insertDocument(card.id, req.body || {}))
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message })
  }
})

app.put('/api/documents/:id', (req, res) => {
  const document = stmt.oneDocument.get(req.params.id)
  if (!document) return res.status(404).json({ error: 'File not found.' })
  const kind = DOCUMENT_KINDS.has(req.body?.kind) ? req.body.kind : document.kind
  const status = DOCUMENT_STATUSES.has(req.body?.status) ? req.body.status : document.status
  const note = 'note' in (req.body || {}) ? String(req.body.note || '').trim().slice(0, 1000) : document.note
  db.prepare('UPDATE documents SET kind = ?, status = ?, note = ? WHERE id = ?').run(kind, status, note, document.id)
  res.json(documentMetadata(stmt.oneDocument.get(document.id)))
})

app.get('/api/documents/:id/file', (req, res) => {
  const document = stmt.oneDocument.get(req.params.id)
  if (!document) return res.status(404).json({ error: 'File not found.' })
  const disposition = document.mimeType === 'application/pdf' || document.mimeType.startsWith('image/')
    ? 'inline'
    : 'attachment'
  res.setHeader('Content-Type', document.mimeType)
  res.setHeader('Content-Length', document.size)
  res.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${encodeURIComponent(document.filename)}`)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.send(document.data)
})

app.delete('/api/documents/:id', (req, res) => {
  stmt.delDocument.run(req.params.id)
  res.status(204).end()
})

app.post('/api/cards/:id/research', async (req, res) => {
  const card = stmt.oneCard.get(req.params.id)
  if (!card) return res.status(404).json({ error: 'Task not found.' })
  if (card.status !== 'progress') {
    return res.status(409).json({ error: 'AI research is available only for cards in “In Progress”.' })
  }
  const board = stmt.oneBoard.get(card.board_id)
  const question = String(req.body?.question || '').trim().slice(0, 1200)
    || 'Check current reliable sources and create a concise action list for this task.'
  try {
    const result = await runWebResearch(card, board, question)
    res.status(201).json(saveResearch(card.id, question, result))
  } catch (error) {
    if (error.status === 503) console.warn(`[ai] ${error.message}`)
    else console.error('[ai]', error)
    res.status(error.status || (error.name === 'AbortError' ? 504 : 500)).json({
      error: error.name === 'AbortError' ? 'Web research timed out.' : error.message,
    })
  }
})

app.delete('/api/research/:id', (req, res) => {
  stmt.delResearch.run(req.params.id)
  res.status(204).end()
})

app.listen(PORT, HOST, () => {
  console.log(`[server] Plainlane API listening on http://${HOST}:${PORT}`)
  console.log(`[db] SQLite file: ${DB_PATH}`)
  console.log(`[ai] ${process.env.OPENAI_API_KEY ? `ready (${OPENAI_MODEL})` : 'not configured'}`)
})
