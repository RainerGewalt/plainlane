// Small fetch wrapper for the SQLite API.
// Vite proxies /api to http://localhost:3001 during local development.
const BASE = '/api'

async function request(method, url, body) {
  const res = await fetch(BASE + url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const payload = await res.json().catch(() => null)
    const error = new Error(payload?.error || `${method} ${url} → HTTP ${res.status}`)
    error.status = res.status
    throw error
  }
  if (res.status === 204) return null
  return res.json()
}

export const api = {
  // Boards
  listBoards: () => request('GET', '/boards'),
  createBoard: (board) => request('POST', '/boards', board),
  updateBoard: (id, patch) => request('PUT', `/boards/${id}`, patch),
  removeBoard: (id) => request('DELETE', `/boards/${id}`),

  // Cards on a board
  listCards: (boardId) => request('GET', `/boards/${boardId}/cards`),
  exportBoard: (boardId) => request('GET', `/boards/${boardId}/export`),
  importBoard: (boardId, cards) => request('POST', `/boards/${boardId}/import`, { cards }),

  // Individual cards
  create: (card) => request('POST', '/cards', card),
  update: (id, patch) => request('PUT', `/cards/${id}`, patch),
  remove: (id) => request('DELETE', `/cards/${id}`),

  // Comments, files, and research
  addComment: (id, text) => request('POST', `/cards/${id}/comments`, { text }),
  removeComment: (commentId) => request('DELETE', `/comments/${commentId}`),
  addDocument: (cardId, document) => request('POST', `/cards/${cardId}/documents`, document),
  updateDocument: (id, patch) => request('PUT', `/documents/${id}`, patch),
  removeDocument: (id) => request('DELETE', `/documents/${id}`),
  aiStatus: () => request('GET', '/ai/status'),
  research: (id, question) => request('POST', `/cards/${id}/research`, { question }),
  removeResearch: (researchId) => request('DELETE', `/research/${researchId}`),
}
