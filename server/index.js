// Plainlane API: SQLite persistence and optional server-side web research.
import express from 'express'
import Database from 'better-sqlite3'
import { fileURLToPath } from 'url'
import { loadEnvFile } from 'node:process'
import path from 'path'
import { SEED_CARDS } from '../src/seed.js'

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
    createdAt INTEGER NOT NULL
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
    createdAt INTEGER
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

// ---------- Prepared statements ----------
const stmt = {
  allBoards: db.prepare('SELECT * FROM boards ORDER BY ord ASC, createdAt ASC'),
  oneBoard: db.prepare('SELECT * FROM boards WHERE id = ?'),
  insBoard: db.prepare(
    'INSERT INTO boards (id, name, emoji, accent, kind, ord, createdAt) VALUES (@id, @name, @emoji, @accent, @kind, @ord, @createdAt)'
  ),
  delBoard: db.prepare('DELETE FROM boards WHERE id = ?'),
  maxBoardOrd: db.prepare('SELECT COALESCE(MAX(ord), -1) AS m FROM boards'),
  countBoards: db.prepare('SELECT COUNT(*) AS n FROM boards'),
  boardCounts: db.prepare(
    `SELECT board_id, COUNT(*) AS total,
            SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done
     FROM cards GROUP BY board_id`
  ),

  cardsByBoard: db.prepare(
    'SELECT id, board_id, title, category, phase, details, contact, status, ord, createdAt FROM cards WHERE board_id = ? ORDER BY ord ASC, createdAt ASC'
  ),
  oneCard: db.prepare(
    'SELECT id, board_id, title, category, phase, details, contact, status, ord, createdAt FROM cards WHERE id = ?'
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
    `INSERT INTO cards (id, board_id, title, category, phase, details, contact, status, ord, createdAt)
     VALUES (@id, @board_id, @title, @category, @phase, @details, @contact, @status, @ord, @createdAt)`
  ),
  delCard: db.prepare('DELETE FROM cards WHERE id = ?'),
  delCardsByBoard: db.prepare('DELETE FROM cards WHERE board_id = ?'),
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
  count: db.prepare('SELECT COUNT(*) AS n FROM cards'),
}

const UPDATABLE = ['title', 'category', 'phase', 'details', 'contact', 'status', 'ord', 'board_id']

function ensureDefaultBoard() {
  if (!stmt.oneBoard.get(DEFAULT_BOARD.id)) {
    stmt.insBoard.run({ ...DEFAULT_BOARD, ord: 0, createdAt: Date.now() })
  }
}

function hydrateResearch(run) {
  return { ...run, sources: stmt.researchSources.all(run.id) }
}

function hydrateCard(row) {
  if (!row) return null
  return {
    ...row,
    comments: stmt.cardComments.all(row.id),
    researchRuns: stmt.cardResearch.all(row.id).map(hydrateResearch),
    documents: stmt.cardDocuments.all(row.id),
  }
}

function listCards(boardId) {
  return stmt.cardsByBoard.all(boardId).map(hydrateCard)
}

function listBoards() {
  const counts = {}
  for (const row of stmt.boardCounts.all()) {
    counts[row.board_id] = { total: row.total, done: row.done || 0 }
  }
  return stmt.allBoards.all().map((board) => {
    const c = counts[board.id] || { total: 0, done: 0 }
    return { ...board, cardCount: c.total, doneCount: c.done, openCount: c.total - c.done }
  })
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
    })
    ;(card.comments || []).forEach((comment) =>
      stmt.insComment.run({
        id: String(comment.id),
        card_id: cardId,
        text: comment.text,
        ts: comment.ts || Date.now(),
      })
    )
    ;(card.researchRuns || []).forEach((run) => insertResearch(cardId, run))
    ;(card.documents || []).forEach((document) => insertDocument(cardId, document))
  })
})

// Create the default board and attach orphaned cards from older databases.
ensureDefaultBoard()
db.prepare('UPDATE cards SET board_id = ? WHERE board_id IS NULL').run(DEFAULT_BOARD.id)

// Seed only a completely empty database.
if (stmt.count.get().n === 0) {
  importIntoBoard(DEFAULT_BOARD.id, SEED_CARDS)
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
  const board = {
    id: rndId('board'),
    name: String(body.name || '').trim() || 'New board',
    emoji: (body.emoji || '🗂️').slice(0, 8),
    accent: body.accent || '#4f46e5',
    kind: 'generic',
    ord: stmt.maxBoardOrd.get().m + 1,
    createdAt: Date.now(),
  }
  stmt.insBoard.run(board)
  res.status(201).json({ ...board, cardCount: 0, doneCount: 0, openCount: 0 })
})

app.put('/api/boards/:id', (req, res) => {
  const board = stmt.oneBoard.get(req.params.id)
  if (!board) return res.status(404).json({ error: 'Board not found.' })
  const allowed = ['name', 'emoji', 'accent', 'ord']
  const keys = allowed.filter((key) => key in (req.body || {}))
  if (keys.length) {
    const setSql = keys.map((key) => `${key} = @${key}`).join(', ')
    db.prepare(`UPDATE boards SET ${setSql} WHERE id = @id`).run({ ...req.body, id: req.params.id })
  }
  res.json(stmt.oneBoard.get(req.params.id))
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
  if (!stmt.oneBoard.get(req.params.id)) return res.status(404).json({ error: 'Board not found.' })
  const cards = req.body?.cards
  if (!Array.isArray(cards)) return res.status(400).json({ error: 'Expected { cards: [...] }.' })
  importIntoBoard(req.params.id, cards)
  res.json(listCards(req.params.id))
})

// ----- Cards -----
app.post('/api/cards', (req, res) => {
  const body = req.body || {}
  const boardId = String(body.board_id || DEFAULT_BOARD.id)
  if (!stmt.oneBoard.get(boardId)) return res.status(400).json({ error: 'Unknown board.' })
  const id = String(body.id || rndId('c'))
  const card = {
    id,
    board_id: boardId,
    title: body.title || 'New task',
    category: body.category || null,
    phase: body.phase || null,
    details: body.details || '',
    contact: body.contact || '',
    status: body.status || 'todo',
    ord: stmt.maxOrd.get(boardId).m + 1,
    createdAt: body.createdAt || Date.now(),
  }
  stmt.insCard.run(card)
  res.status(201).json(hydrateCard(stmt.oneCard.get(id)))
})

app.put('/api/cards/:id', (req, res) => {
  const existing = stmt.oneCard.get(req.params.id)
  if (!existing) return res.status(404).json({ error: 'Task not found.' })
  const keys = UPDATABLE.filter((key) => key in (req.body || {}))
  if (keys.length) {
    const setSql = keys.map((key) => `${key} = @${key}`).join(', ')
    db.prepare(`UPDATE cards SET ${setSql} WHERE id = @id`).run({ ...req.body, id: req.params.id })
  }
  res.json(hydrateCard(stmt.oneCard.get(req.params.id)))
})

app.delete('/api/cards/:id', (req, res) => {
  stmt.delCard.run(req.params.id)
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
