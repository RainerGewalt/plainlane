import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import {
  createDatabaseBackup,
  listDatabaseBackups,
  resolveDatabaseBackup,
  restoreDatabaseBackup,
} from '../server/database-maintenance.js'

test('creates and restores a complete SQLite backup', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'plainlane-backup-test-'))
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const databasePath = path.join(directory, 'plainlane.db')
  const database = new Database(databasePath)
  database.exec('CREATE TABLE sample (value TEXT NOT NULL)')
  database.prepare('INSERT INTO sample (value) VALUES (?)').run('before')
  database.close()

  const backupPath = await createDatabaseBackup(databasePath, { label: 'test' })
  assert.ok(fs.existsSync(backupPath))
  const backupName = path.basename(backupPath)
  assert.equal(resolveDatabaseBackup(databasePath).name, backupName)

  const changed = new Database(databasePath)
  changed.prepare('UPDATE sample SET value = ?').run('after')
  changed.close()
  restoreDatabaseBackup(databasePath, backupName)

  const restored = new Database(databasePath, { readonly: true })
  assert.equal(restored.prepare('SELECT value FROM sample').get().value, 'before')
  restored.close()
})

test('keeps only the configured number of rolling backups', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'plainlane-backup-limit-test-'))
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const databasePath = path.join(directory, 'plainlane.db')
  const database = new Database(databasePath)
  database.exec('CREATE TABLE sample (value INTEGER NOT NULL)')
  database.prepare('INSERT INTO sample (value) VALUES (1)').run()
  database.close()

  await createDatabaseBackup(databasePath, { label: 'one', limit: 2 })
  await new Promise((resolve) => setTimeout(resolve, 5))
  await createDatabaseBackup(databasePath, { label: 'two', limit: 2 })
  await new Promise((resolve) => setTimeout(resolve, 5))
  await createDatabaseBackup(databasePath, { label: 'three', limit: 2 })

  assert.equal(listDatabaseBackups(databasePath).length, 2)
})
