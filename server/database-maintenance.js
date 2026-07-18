import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_LIMIT = 10

function backupDirectory(databasePath) {
  return path.join(path.dirname(databasePath), 'backups')
}

function safeLabel(value) {
  return String(value || 'manual').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '') || 'manual'
}

function timestamp() {
  return new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '')
}

export function listDatabaseBackups(databasePath) {
  const directory = backupDirectory(databasePath)
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory)
    .filter((name) => /^plainlane-.+\.db$/.test(name))
    .sort((left, right) => right.localeCompare(left))
}

export async function createDatabaseBackup(databasePath, options = {}) {
  if (!fs.existsSync(databasePath)) return null
  const directory = backupDirectory(databasePath)
  fs.mkdirSync(directory, { recursive: true })
  const destination = path.join(directory, `plainlane-${timestamp()}-${safeLabel(options.label)}.db`)
  const connection = options.database || new Database(databasePath, { readonly: true, fileMustExist: true })
  try {
    await connection.backup(destination)
  } finally {
    if (!options.database) connection.close()
  }

  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : DEFAULT_LIMIT
  for (const expired of listDatabaseBackups(databasePath).slice(limit)) {
    fs.unlinkSync(path.join(directory, expired))
  }
  return destination
}

export function resolveDatabaseBackup(databasePath, requested) {
  const backups = listDatabaseBackups(databasePath)
  const name = requested || backups[0]
  if (!name || name !== path.basename(name) || !backups.includes(name)) {
    throw new Error(requested ? `Backup not found: ${requested}` : 'No Plainlane backup is available.')
  }
  return { name, fullPath: path.join(backupDirectory(databasePath), name) }
}

export function restoreDatabaseBackup(databasePath, requested) {
  const backup = resolveDatabaseBackup(databasePath, requested)
  fs.mkdirSync(path.dirname(databasePath), { recursive: true })
  const stagedPath = `${databasePath}.restore`
  fs.copyFileSync(backup.fullPath, stagedPath)
  fs.renameSync(stagedPath, databasePath)
  for (const suffix of ['-wal', '-shm']) {
    const companion = `${databasePath}${suffix}`
    if (fs.existsSync(companion)) fs.unlinkSync(companion)
  }
  return backup.name
}

async function main() {
  const databasePath = path.resolve(process.env.DB_PATH || path.join(path.dirname(fileURLToPath(import.meta.url)), 'plainlane.db'))
  const [command = 'list', value, rawLimit] = process.argv.slice(2)
  if (command === 'backup') {
    const limit = Number(rawLimit)
    const destination = await createDatabaseBackup(databasePath, {
      label: value || 'manual',
      limit: Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_LIMIT,
    })
    console.log(destination ? path.basename(destination) : 'No database exists yet.')
    return
  }
  if (command === 'latest') {
    console.log(resolveDatabaseBackup(databasePath).name)
    return
  }
  if (command === 'resolve') {
    console.log(resolveDatabaseBackup(databasePath, value).name)
    return
  }
  if (command === 'list') {
    for (const name of listDatabaseBackups(databasePath)) console.log(name)
    return
  }
  if (command === 'restore') {
    console.log(restoreDatabaseBackup(databasePath, value))
    return
  }
  throw new Error(`Unknown database maintenance command: ${command}`)
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
