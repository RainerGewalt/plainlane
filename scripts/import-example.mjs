// Creates a board and fills it with one of the fictional example files.
//
//   node scripts/import-example.mjs examples/boards/move-to-switzerland.json
//   node scripts/import-example.mjs <file> [board name] [emoji] [accent]
//
// The API base URL can be overridden for other setups:
//   PLAINLANE_API=http://127.0.0.1:8080/api node scripts/import-example.mjs <file>

import fs from 'node:fs'
import path from 'node:path'

const API = (process.env.PLAINLANE_API || 'http://127.0.0.1:3001/api').replace(/\/$/, '')
const [file, nameArg, emojiArg, accentArg] = process.argv.slice(2)

if (!file) {
  console.error('Usage: node scripts/import-example.mjs <file.json> [board name] [emoji] [accent]')
  process.exit(2)
}

function titleFromFilename(filePath) {
  const base = path.basename(filePath, '.json').replace(/[-_]+/g, ' ').trim()
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : 'Example board'
}

async function request(method, url, body) {
  let response
  try {
    response = await fetch(API + url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new Error(`Plainlane is not reachable at ${API}. Start it first, for example with ./start.sh.`)
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new Error(payload?.error || `${method} ${url} → HTTP ${response.status}`)
  }
  return response.status === 204 ? null : response.json()
}

let cards
try {
  cards = JSON.parse(fs.readFileSync(file, 'utf8'))
} catch (error) {
  console.error(`Could not read ${file}: ${error.message}`)
  process.exit(1)
}
if (!Array.isArray(cards)) {
  console.error(`${file} does not contain a board export (expected a JSON array of tasks).`)
  process.exit(1)
}

try {
  const board = await request('POST', '/boards', {
    name: nameArg || titleFromFilename(file),
    emoji: emojiArg || '🗂️',
    accent: accentArg || '#4f46e5',
  })
  await request('POST', `/boards/${board.id}/import`, { cards })
  console.log(`Created the board “${board.name}” with ${cards.length} tasks.`)
} catch (error) {
  console.error(error.message)
  process.exit(1)
}
