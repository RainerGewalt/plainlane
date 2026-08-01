// Plainlane API: SQLite persistence and optional server-side web research.
import express from 'express'
import Database from 'better-sqlite3'
import { fileURLToPath } from 'url'
import { loadEnvFile } from 'node:process'
import fs from 'node:fs'
import path from 'path'
import { SEED_CARDS } from '../src/seed.js'
import { isSubtaskStatus, subtaskSummary, subtasksResolved } from '../src/subtasks.js'
import { DEFAULT_LANE, LANE_IDS, isLaneId } from '../src/lanes.js'
import { ACCENT_PATTERN, BOARD_EMOJI_MAX, BOARD_NAME_MAX } from '../src/validation.js'
import { createDatabaseBackup } from './database-maintenance.js'

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

const databaseAlreadyExists = fs.existsSync(DB_PATH)
const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

if (databaseAlreadyExists && process.env.PLAINLANE_AUTO_BACKUP !== '0') {
  const backupPath = await createDatabaseBackup(DB_PATH, { label: 'startup', database: db })
  console.log(`[db] Backup created before migrations: ${backupPath}`)
}

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
    show_lane_age INTEGER NOT NULL DEFAULT 0,
    archived_at INTEGER DEFAULT NULL,
    deleted_at INTEGER DEFAULT NULL
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
    status_changed_at INTEGER,
    archived_at INTEGER DEFAULT NULL
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
if (!cardColumns.includes('archived_at')) db.exec('ALTER TABLE cards ADD COLUMN archived_at INTEGER DEFAULT NULL')
db.prepare('UPDATE cards SET status_changed_at = ? WHERE status_changed_at IS NULL').run(Date.now())

const boardColumns = db.prepare('PRAGMA table_info(boards)').all().map((c) => c.name)
if (!boardColumns.includes('subtask_limit')) db.exec('ALTER TABLE boards ADD COLUMN subtask_limit INTEGER NOT NULL DEFAULT 10')
if (!boardColumns.includes('progress_limit')) db.exec('ALTER TABLE boards ADD COLUMN progress_limit INTEGER DEFAULT NULL')
if (!boardColumns.includes('show_lane_age')) db.exec('ALTER TABLE boards ADD COLUMN show_lane_age INTEGER NOT NULL DEFAULT 0')
if (!boardColumns.includes('archived_at')) db.exec('ALTER TABLE boards ADD COLUMN archived_at INTEGER DEFAULT NULL')
if (!boardColumns.includes('deleted_at')) db.exec('ALTER TABLE boards ADD COLUMN deleted_at INTEGER DEFAULT NULL')

// ---------- Prepared statements ----------
const stmt = {
  allBoards: db.prepare('SELECT * FROM boards ORDER BY ord ASC, createdAt ASC'),
  activeBoards: db.prepare(
    'SELECT * FROM boards WHERE archived_at IS NULL AND deleted_at IS NULL ORDER BY ord ASC, createdAt ASC'
  ),
  storedBoards: db.prepare(
    `SELECT * FROM boards WHERE archived_at IS NOT NULL OR deleted_at IS NOT NULL
     ORDER BY COALESCE(deleted_at, archived_at) DESC, createdAt ASC`
  ),
  oneBoard: db.prepare('SELECT * FROM boards WHERE id = ?'),
  oneActiveBoard: db.prepare(
    'SELECT * FROM boards WHERE id = ? AND archived_at IS NULL AND deleted_at IS NULL'
  ),
  insBoard: db.prepare(
    `INSERT INTO boards
      (id, name, emoji, accent, kind, ord, createdAt, subtask_limit, progress_limit, show_lane_age)
     VALUES
      (@id, @name, @emoji, @accent, @kind, @ord, @createdAt, @subtask_limit, @progress_limit, @show_lane_age)`
  ),
  delBoard: db.prepare('DELETE FROM boards WHERE id = ?'),
  maxBoardOrd: db.prepare('SELECT COALESCE(MAX(ord), -1) AS m FROM boards'),
  countActiveBoards: db.prepare(
    'SELECT COUNT(*) AS n FROM boards WHERE archived_at IS NULL AND deleted_at IS NULL'
  ),
  archiveBoard: db.prepare(
    'UPDATE boards SET archived_at = ?, deleted_at = NULL WHERE id = ?'
  ),
  trashBoard: db.prepare(
    'UPDATE boards SET deleted_at = ?, archived_at = NULL WHERE id = ?'
  ),
  restoreBoard: db.prepare(
    'UPDATE boards SET archived_at = NULL, deleted_at = NULL WHERE id = ?'
  ),
  boardCounts: db.prepare(
    `SELECT board_id,
            SUM(CASE WHEN archived_at IS NULL THEN 1 ELSE 0 END) AS total,
            SUM(CASE WHEN archived_at IS NULL AND status = 'done' THEN 1 ELSE 0 END) AS done,
            SUM(CASE WHEN archived_at IS NULL AND status = 'progress' THEN 1 ELSE 0 END) AS progress,
            SUM(CASE WHEN archived_at IS NOT NULL THEN 1 ELSE 0 END) AS archived
     FROM cards GROUP BY board_id`
  ),

  cardsByBoard: db.prepare(
    `SELECT id, board_id, title, category, phase, details, contact, status, ord, createdAt,
            status_changed_at AS statusChangedAt, archived_at AS archivedAt
     FROM cards WHERE board_id = ? AND archived_at IS NULL ORDER BY ord ASC, createdAt ASC`
  ),
  allCardsByBoard: db.prepare(
    `SELECT id, board_id, title, category, phase, details, contact, status, ord, createdAt,
            status_changed_at AS statusChangedAt, archived_at AS archivedAt
     FROM cards WHERE board_id = ? ORDER BY ord ASC, createdAt ASC`
  ),
  archivedCardsByBoard: db.prepare(
    `SELECT id, board_id, title, category, phase, details, contact, status, ord, createdAt,
            status_changed_at AS statusChangedAt, archived_at AS archivedAt
     FROM cards WHERE board_id = ? AND archived_at IS NOT NULL ORDER BY archived_at DESC, createdAt ASC`
  ),
  oneCard: db.prepare(
    `SELECT id, board_id, title, category, phase, details, contact, status, ord, createdAt,
            status_changed_at AS statusChangedAt, archived_at AS archivedAt
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
      (id, board_id, title, category, phase, details, contact, status, ord, createdAt, status_changed_at, archived_at)
     VALUES
      (@id, @board_id, @title, @category, @phase, @details, @contact, @status, @ord, @createdAt, @status_changed_at, @archived_at)`
  ),
  archiveCard: db.prepare('UPDATE cards SET archived_at = ? WHERE id = ? AND archived_at IS NULL'),
  restoreCard: db.prepare('UPDATE cards SET archived_at = NULL WHERE id = ? AND archived_at IS NOT NULL'),
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
  progressCount: db.prepare(
    "SELECT COUNT(*) AS n FROM cards WHERE board_id = ? AND status = 'progress' AND archived_at IS NULL"
  ),
  count: db.prepare('SELECT COUNT(*) AS n FROM cards'),
}

const UPDATABLE = ['title', 'category', 'phase', 'details', 'contact', 'status', 'ord', 'board_id']

function ensureDefaultBoard() {
  if (!stmt.oneBoard.get(DEFAULT_BOARD.id)) {
    stmt.insBoard.run({ ...DEFAULT_BOARD, ord: 0, createdAt: Date.now() })
  }
}

function ensureInitialBoard() {
  const existingBoard = stmt.activeBoards.all()[0]
  if (existingBoard) return existingBoard
  const storedBoard = stmt.allBoards.all()[0]
  if (storedBoard) {
    stmt.restoreBoard.run(storedBoard.id)
    return stmt.oneBoard.get(storedBoard.id)
  }
  ensureDefaultBoard()
  return stmt.oneBoard.get(DEFAULT_BOARD.id)
}

const rndId = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

// Errors carrying a `status` are turned into a JSON response by the route that
// throws them, or by the error handler at the end of this file.
function httpError(status, message) {
  return Object.assign(new Error(message), { status })
}

function hydrateResearch(run) {
  return { ...run, sources: stmt.researchSources.all(run.id) }
}

function hydrateCard(row) {
  if (!row) return null
  const subtasks = stmt.cardSubtasks.all(row.id)

  const latestSubtaskTime = subtasks.length > 0 ? Math.max(...subtasks.map(s => s.createdAt)) : row.createdAt
  const updatedAt = Math.max(row.createdAt || 0, row.statusChangedAt || 0, latestSubtaskTime || 0)

  return {
    ...row,
    comments: stmt.cardComments.all(row.id),
    researchRuns: stmt.cardResearch.all(row.id).map(hydrateResearch),
    documents: stmt.cardDocuments.all(row.id),
    subtasks,
    ...subtaskSummary(subtasks),
    updatedAt,
  }
}

function listCards(boardId) {
  return stmt.cardsByBoard.all(boardId).map(hydrateCard)
}

function listArchivedCards(boardId) {
  return stmt.archivedCardsByBoard.all(boardId).map(hydrateCard)
}

function boardsWithCounts(rows) {
  const counts = {}
  for (const row of stmt.boardCounts.all()) {
    counts[row.board_id] = {
      total: row.total || 0,
      done: row.done || 0,
      progress: row.progress || 0,
      archived: row.archived || 0,
    }
  }
  return rows.map((board) => {
    const c = counts[board.id] || { total: 0, done: 0, progress: 0, archived: 0 }
    return {
      ...board,
      cardCount: c.total,
      doneCount: c.done,
      progressCount: c.progress,
      archivedCount: c.archived,
      openCount: c.total - c.done,
    }
  })
}

function listBoards() {
  return boardsWithCounts(stmt.activeBoards.all())
}

function listStoredBoards() {
  return boardsWithCounts(stmt.storedBoards.all())
}

function parseProgressLimit(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null
  const limit = Number(value)
  if (!Number.isInteger(limit) || limit < 1 || limit > 999) {
    throw httpError(400, 'In Progress limit must be empty or a whole number from 1 to 999.')
  }
  return limit
}

function toSqliteBoolean(value) {
  return value === true || value === 1 || value === '1' || value === 'true' ? 1 : 0
}

function parseSubtaskLimit(value) {
  return Math.max(1, Math.min(10, Number(value) || 10))
}

// Board text fields are validated here as well as in the browser form, so the
// API can never store a nameless board or a colour the CSS cannot use.
function parseBoardName(value) {
  if (typeof value !== 'string') throw httpError(400, 'The board name must be text.')
  const name = value.trim()
  if (!name) throw httpError(400, 'Please enter a board name.')
  if (name.length > BOARD_NAME_MAX) throw httpError(400, `Use ${BOARD_NAME_MAX} characters or fewer for the board name.`)
  return name
}

function parseBoardEmoji(value) {
  if (typeof value !== 'string') throw httpError(400, 'The board icon must be text.')
  const emoji = value.trim().slice(0, BOARD_EMOJI_MAX)
  if (!emoji) throw httpError(400, 'Pick a board icon.')
  return emoji
}

function parseAccent(value) {
  if (typeof value !== 'string' || !ACCENT_PATTERN.test(value.trim())) {
    throw httpError(400, 'The board colour must be a hex value such as #4f46e5.')
  }
  return value.trim().toLowerCase()
}

// Cards live in exactly one of the three lanes; anything else would hide the
// card from every column in the board view.
function parseCardStatus(value, fallback = DEFAULT_LANE) {
  if (value === undefined || value === null || value === '') return fallback
  const status = String(value)
  if (!isLaneId(status)) throw httpError(400, `Unknown lane “${status}”. Use ${LANE_IDS.join(', ')}.`)
  return status
}

function parseSubtaskStatus(value, fallback = 'todo') {
  if (value === undefined || value === null || value === '') return fallback
  const status = String(value)
  if (!isSubtaskStatus(status)) throw httpError(400, `Unknown subtask status “${status}”.`)
  return status
}

function ensureProgressCapacity(boardId) {
  const board = stmt.oneBoard.get(boardId)
  if (!board) throw httpError(400, 'Unknown board.')
  if (board.progress_limit !== null && stmt.progressCount.get(boardId).n >= board.progress_limit) {
    throw httpError(409, `In Progress limit (${board.progress_limit}) reached for this board.`)
  }
  return board
}

// Comments, subtasks, files, and research may only be attached to a card that is
// not archived — the same rule the card editor itself enforces.
function editableCard(id) {
  const card = stmt.oneCard.get(id)
  if (!card) throw httpError(404, 'Task not found.')
  if (card.archivedAt !== null) throw httpError(409, 'Restore this task before editing it.')
  return card
}

function insertResearch(cardId, run) {
  const researchId = String(run.id || rndId('r'))
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
    throw httpError(400, 'Allowed file types: PDF, email files, images, DOC, DOCX, ODT, and TXT.')
  }
  const encoded = String(payload?.dataBase64 || '').replace(/^data:[^;]+;base64,/, '')
  const data = Buffer.from(encoded, 'base64')
  if (!data.length) throw httpError(400, 'The file is empty or could not be read.')
  if (data.length > MAX_DOCUMENT_BYTES) throw httpError(413, 'The file is larger than 15 MB.')
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
  const id = String(payload.id || rndId('d'))
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
  return stmt.allCardsByBoard.all(boardId).map((row) => {
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
// Backups are hand-editable, so every field falls back to a usable value and an
// unusable one is reported instead of aborting halfway through.
const importIntoBoard = db.transaction((boardId, cards) => {
  stmt.delCardsByBoard.run(boardId)
  const usedIds = new Set()
  const uniqueId = (prefix, value) => {
    const candidate = value === undefined || value === null || value === '' ? rndId(prefix) : String(value)
    const id = usedIds.has(candidate) ? rndId(prefix) : candidate
    usedIds.add(id)
    return id
  }

  cards.forEach((card, index) => {
    const cardId = uniqueId('c', card.id)
    stmt.insCard.run({
      id: cardId,
      board_id: boardId,
      title: String(card.title || 'Untitled task'),
      category: card.category || null,
      phase: card.phase || null,
      details: String(card.details || ''),
      contact: String(card.contact || ''),
      status: parseCardStatus(card.status),
      ord: Number.isFinite(card.ord) ? card.ord : index,
      createdAt: card.createdAt || Date.now(),
      status_changed_at: card.statusChangedAt || card.createdAt || Date.now(),
      archived_at: card.archivedAt || null,
    })
    ;(card.comments || []).forEach((comment) =>
      stmt.insComment.run({
        id: uniqueId('m', comment.id),
        card_id: cardId,
        text: String(comment.text || ''),
        ts: comment.ts || Date.now(),
      })
    )
    ;(card.subtasks || []).forEach((subtask, subtaskIndex) =>
      stmt.insSubtask.run({
        id: uniqueId('s', subtask.id),
        card_id: cardId,
        title: String(subtask.title || 'Unnamed subtask'),
        status: parseSubtaskStatus(subtask.status),
        ord: Number.isFinite(subtask.ord) ? subtask.ord : subtaskIndex,
        createdAt: subtask.createdAt || Date.now(),
      })
    )
    ;(card.researchRuns || []).forEach((run) => insertResearch(cardId, { ...run, id: uniqueId('r', run.id) }))
    ;(card.documents || []).forEach((document) =>
      insertDocument(cardId, { ...document, id: uniqueId('d', document.id) })
    )
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
  if (!apiKey) throw httpError(503, 'OPENAI_API_KEY is missing. Add it to the local .env file.')

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
    throw httpError(
      response.status >= 500 ? 502 : 400,
      payload.error?.message || `OpenAI request failed (HTTP ${response.status}).`
    )
  }

  return { ...extractResearch(payload), model: payload.model || OPENAI_MODEL }
}

const saveResearch = db.transaction((cardId, question, result) => {
  const id = rndId('r')
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

// ---------- API ----------
const app = express()
app.use(express.json({ limit: '100mb' }))

app.get('/api/health', (_req, res) => res.json({ ok: true }))

app.get('/api/ai/status', (_req, res) => {
  res.json({ configured: Boolean(process.env.OPENAI_API_KEY), model: OPENAI_MODEL })
})

// ----- Boards -----
app.get('/api/boards', (_req, res) => res.json(listBoards()))
app.get('/api/boards/storage', (_req, res) => res.json(listStoredBoards()))

app.post('/api/boards', (req, res) => {
  const body = req.body || {}
  try {
    const board = {
      id: rndId('board'),
      name: parseBoardName(body.name === undefined ? 'New board' : body.name),
      emoji: parseBoardEmoji(body.emoji === undefined ? '🗂️' : body.emoji),
      accent: parseAccent(body.accent === undefined ? '#4f46e5' : body.accent),
      kind: 'generic',
      ord: stmt.maxBoardOrd.get().m + 1,
      createdAt: Date.now(),
      subtask_limit: parseSubtaskLimit(body.subtask_limit),
      progress_limit: parseProgressLimit(body.progress_limit),
      show_lane_age: toSqliteBoolean(body.show_lane_age),
    }
    stmt.insBoard.run(board)
    res.status(201).json({
      ...board,
      archived_at: null,
      deleted_at: null,
      cardCount: 0,
      doneCount: 0,
      progressCount: 0,
      archivedCount: 0,
      openCount: 0,
    })
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message })
  }
})

app.put('/api/boards/:id', (req, res) => {
  const board = stmt.oneActiveBoard.get(req.params.id)
  if (!board) return res.status(404).json({ error: 'Board not found.' })
  const body = req.body || {}
  const allowed = ['name', 'emoji', 'accent', 'ord', 'subtask_limit', 'progress_limit', 'show_lane_age']
  const keys = allowed.filter((key) => key in body)
  try {
    if (keys.length) {
      const setSql = keys.map((key) => `${key} = @${key}`).join(', ')
      // Every allowed key is normalised below, so nothing from the request body
      // reaches SQLite unchecked.
      const values = { id: req.params.id }
      if ('name' in body) values.name = parseBoardName(body.name)
      if ('emoji' in body) values.emoji = parseBoardEmoji(body.emoji)
      if ('accent' in body) values.accent = parseAccent(body.accent)
      if ('ord' in body) values.ord = Number(body.ord) || 0
      if ('subtask_limit' in body) values.subtask_limit = parseSubtaskLimit(body.subtask_limit)
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

app.post('/api/boards/:id/archive', (req, res) => {
  const board = stmt.oneActiveBoard.get(req.params.id)
  if (!board) return res.status(404).json({ error: 'Active board not found.' })
  if (stmt.countActiveBoards.get().n <= 1) {
    return res.status(409).json({ error: 'The last active board cannot be archived.' })
  }
  stmt.archiveBoard.run(Date.now(), req.params.id)
  res.json(stmt.oneBoard.get(req.params.id))
})

app.post('/api/boards/:id/trash', (req, res) => {
  const board = stmt.oneActiveBoard.get(req.params.id)
  if (!board) return res.status(404).json({ error: 'Active board not found.' })
  if (stmt.countActiveBoards.get().n <= 1) {
    return res.status(409).json({ error: 'The last active board cannot be moved to trash.' })
  }
  stmt.trashBoard.run(Date.now(), req.params.id)
  res.json(stmt.oneBoard.get(req.params.id))
})

app.post('/api/boards/:id/restore', (req, res) => {
  const board = stmt.oneBoard.get(req.params.id)
  if (!board) return res.status(404).json({ error: 'Board not found.' })
  if (board.archived_at === null && board.deleted_at === null) {
    return res.status(409).json({ error: 'Board is already active.' })
  }
  stmt.restoreBoard.run(req.params.id)
  res.json(boardsWithCounts([stmt.oneBoard.get(req.params.id)])[0])
})

app.delete('/api/boards/:id', (req, res) => {
  const board = stmt.oneBoard.get(req.params.id)
  if (!board) return res.status(404).json({ error: 'Board not found.' })
  if (board.deleted_at === null) {
    return res.status(409).json({ error: 'Only boards in trash can be deleted permanently.' })
  }
  const remove = db.transaction((id) => {
    stmt.delCardsByBoard.run(id)
    stmt.delBoard.run(id)
  })
  remove(req.params.id)
  res.status(204).end()
})

app.get('/api/boards/:id/cards', (req, res) => {
  if (!stmt.oneActiveBoard.get(req.params.id)) return res.status(404).json({ error: 'Active board not found.' })
  res.json(listCards(req.params.id))
})

app.get('/api/boards/:id/cards/archive', (req, res) => {
  if (!stmt.oneActiveBoard.get(req.params.id)) return res.status(404).json({ error: 'Active board not found.' })
  res.json(listArchivedCards(req.params.id))
})

app.get('/api/boards/:id/export', (req, res) => {
  if (!stmt.oneBoard.get(req.params.id)) return res.status(404).json({ error: 'Board not found.' })
  res.json(exportCards(req.params.id))
})

app.post('/api/boards/:id/import', (req, res) => {
  const board = stmt.oneActiveBoard.get(req.params.id)
  if (!board) return res.status(404).json({ error: 'Board not found.' })
  const cards = req.body?.cards
  if (!Array.isArray(cards)) return res.status(400).json({ error: 'Expected { cards: [...] }.' })
  if (cards.some((card) => !card || typeof card !== 'object')) {
    return res.status(400).json({ error: 'Every entry in the backup must be a task object.' })
  }
  const progressCount = cards.filter((card) => !card.archivedAt && (card.status || 'todo') === 'progress').length
  if (board.progress_limit !== null && progressCount > board.progress_limit) {
    return res.status(409).json({
      error: `Import contains ${progressCount} In Progress tasks, exceeding this board's limit (${board.progress_limit}).`,
    })
  }
  try {
    importIntoBoard(req.params.id, cards)
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message })
    console.error('[import]', error)
    return res.status(400).json({ error: 'The backup could not be imported. Please check the file.' })
  }
  res.json(listCards(req.params.id))
})

// ----- Cards -----
app.post('/api/cards', (req, res) => {
  const body = req.body || {}
  const boardId = String(body.board_id || DEFAULT_BOARD.id)
  if (!stmt.oneActiveBoard.get(boardId)) return res.status(400).json({ error: 'Unknown active board.' })
  try {
    const status = parseCardStatus(body.status)
    if (status === 'progress') ensureProgressCapacity(boardId)
    const id = String(body.id || rndId('c'))
    if (stmt.oneCard.get(id)) return res.status(409).json({ error: 'A task with this id already exists.' })
    const createdAt = body.createdAt || Date.now()
    stmt.insCard.run({
      id,
      board_id: boardId,
      title: String(body.title || 'New task'),
      category: body.category || null,
      phase: body.phase || null,
      details: String(body.details || ''),
      contact: String(body.contact || ''),
      status,
      ord: stmt.maxOrd.get(boardId).m + 1,
      createdAt,
      status_changed_at: createdAt,
      archived_at: null,
    })
    res.status(201).json(hydrateCard(stmt.oneCard.get(id)))
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message })
  }
})

app.put('/api/cards/:id', (req, res) => {
  const existing = stmt.oneCard.get(req.params.id)
  if (!existing) return res.status(404).json({ error: 'Task not found.' })
  if (existing.archivedAt !== null) {
    return res.status(409).json({ error: 'Restore this task before editing it.' })
  }
  const body = req.body || {}
  const nextBoardId = 'board_id' in body ? String(body.board_id) : existing.board_id

  try {
    const nextStatus = 'status' in body ? parseCardStatus(body.status, existing.status) : existing.status
    const entersProgress = nextStatus === 'progress'
      && (existing.status !== 'progress' || existing.board_id !== nextBoardId)

    if (!stmt.oneActiveBoard.get(nextBoardId)) {
      return res.status(400).json({ error: 'Unknown active board.' })
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
      // Only the allowed keys are bound, and each one is coerced to a type
      // SQLite accepts so a malformed request cannot reach the driver.
      const values = { id: req.params.id }
      if ('status' in body) values.status = nextStatus
      if ('board_id' in body) values.board_id = nextBoardId
      if ('ord' in body) values.ord = Number(body.ord) || 0
      if ('title' in body) values.title = String(body.title ?? '').trim() || 'Untitled task'
      if ('details' in body) values.details = String(body.details ?? '')
      if ('contact' in body) values.contact = String(body.contact ?? '')
      for (const key of ['category', 'phase']) {
        if (key in body) values[key] = body[key] ? String(body[key]) : null
      }
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

app.post('/api/cards/:id/archive', (req, res) => {
  const card = stmt.oneCard.get(req.params.id)
  if (!card) return res.status(404).json({ error: 'Task not found.' })
  if (card.archivedAt !== null) return res.status(409).json({ error: 'Task is already archived.' })
  stmt.archiveCard.run(Date.now(), req.params.id)
  res.json(hydrateCard(stmt.oneCard.get(req.params.id)))
})

app.post('/api/cards/:id/restore', (req, res) => {
  const card = stmt.oneCard.get(req.params.id)
  if (!card) return res.status(404).json({ error: 'Task not found.' })
  if (card.archivedAt === null) return res.status(409).json({ error: 'Task is already active.' })
  if (!stmt.oneActiveBoard.get(card.board_id)) {
    return res.status(409).json({ error: 'Restore the board before restoring this task.' })
  }
  try {
    if (card.status === 'progress') ensureProgressCapacity(card.board_id)
    stmt.restoreCard.run(req.params.id)
    res.json(hydrateCard(stmt.oneCard.get(req.params.id)))
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message })
  }
})

app.delete('/api/cards/:id', (req, res) => {
  const card = stmt.oneCard.get(req.params.id)
  if (!card) return res.status(404).json({ error: 'Task not found.' })
  if (card.archivedAt === null) {
    return res.status(409).json({ error: 'Archive this task before deleting it permanently.' })
  }
  stmt.delCard.run(req.params.id)
  res.status(204).end()
})

// ----- Subtasks -----
app.post('/api/cards/:id/subtasks', (req, res) => {
  try {
    const card = editableCard(req.params.id)
    const board = stmt.oneBoard.get(card.board_id)
    const limit = board?.subtask_limit || 10
    const subtasks = stmt.cardSubtasks.all(req.params.id)
    if (subtasks.length >= limit) {
      return res.status(409).json({ error: `Subtask limit (${limit}) reached for this board.` })
    }
    const title = String(req.body?.title || '').trim().slice(0, 500)
    if (!title) return res.status(400).json({ error: 'Subtask title cannot be empty.' })
    const subtaskId = rndId('s')
    stmt.insSubtask.run({
      id: subtaskId,
      card_id: req.params.id,
      title,
      status: 'todo',
      // Continue after the highest position so a deleted subtask cannot leave
      // two siblings sharing one order value.
      ord: subtasks.reduce((max, subtask) => Math.max(max, subtask.ord), -1) + 1,
      createdAt: Date.now(),
    })
    res.status(201).json(stmt.oneSubtask.get(subtaskId))
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message })
  }
})

app.put('/api/subtasks/:id', (req, res) => {
  const existing = stmt.oneSubtask.get(req.params.id)
  if (!existing) return res.status(404).json({ error: 'Subtask not found.' })
  const body = req.body || {}
  const allowed = ['title', 'status', 'ord']
  const keys = allowed.filter((key) => key in body)
  try {
    if (keys.length) {
      const setSql = keys.map((key) => `${key} = @${key}`).join(', ')
      const updates = { id: req.params.id }
      if ('title' in body) updates.title = String(body.title || '').trim().slice(0, 500) || 'Unnamed'
      if ('status' in body) updates.status = parseSubtaskStatus(body.status, existing.status)
      if ('ord' in body) updates.ord = Number(body.ord) || 0
      db.prepare(`UPDATE subtasks SET ${setSql} WHERE id = @id`).run(updates)
    }
    res.json(stmt.oneSubtask.get(req.params.id))
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message })
  }
})

app.delete('/api/subtasks/:id', (req, res) => {
  stmt.delSubtask.run(req.params.id)
  res.status(204).end()
})

app.post('/api/cards/:id/comments', (req, res) => {
  try {
    const card = editableCard(req.params.id)
    const text = String(req.body?.text || '').trim()
    if (!text) return res.status(400).json({ error: 'The comment is empty.' })
    const comment = { id: rndId('m'), card_id: card.id, text, ts: Date.now() }
    stmt.insComment.run(comment)
    res.status(201).json({ id: comment.id, text: comment.text, ts: comment.ts })
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message })
  }
})

app.delete('/api/comments/:id', (req, res) => {
  stmt.delComment.run(req.params.id)
  res.status(204).end()
})

// ----- Files and saved emails -----
app.post('/api/cards/:id/documents', (req, res) => {
  try {
    const card = editableCard(req.params.id)
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
  let card
  try {
    card = editableCard(req.params.id)
    if (card.status !== 'progress') {
      return res.status(409).json({ error: 'AI research is available only for cards in “In Progress”.' })
    }
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message })
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

// Last line of defence: the client expects JSON, and an Express stack trace page
// would leak local file paths into the browser.
app.use((error, _req, res, _next) => {
  const status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599
    ? error.status
    : 500
  if (status >= 500) console.error('[api]', error)
  res.status(status).json({
    error: status >= 500 ? 'Unexpected server error. Check the server log.' : error.message,
  })
})

app.listen(PORT, HOST, () => {
  console.log(`[server] Plainlane API listening on http://${HOST}:${PORT}`)
  console.log(`[db] SQLite file: ${DB_PATH}`)
  console.log(`[ai] ${process.env.OPENAI_API_KEY ? `ready (${OPENAI_MODEL})` : 'not configured'}`)
})
