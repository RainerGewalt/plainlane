// Guards the Docker install path. The `api` stage of the Dockerfile copies
// only selected files, so a new server import of a file that the stage does
// not copy (or of a devDependency, which `npm ci --omit=dev` leaves out)
// passes every other check and only fails when the container starts, with
// ERR_MODULE_NOT_FOUND. This test follows the imports of the scripts that run
// inside the api image and checks each one against the files the stage puts
// into the image. It reads the Dockerfile and needs no Docker daemon.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { isBuiltin } from 'node:module'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const STAGE = 'api'

// Besides its CMD, the api image runs the scripts that start.sh starts in the
// app container (`--entrypoint node app <script>`, for backup and restore).
function startScriptEntries() {
  const startScript = path.join(ROOT, 'start.sh')
  if (!fs.existsSync(startScript)) return []
  return [...fs.readFileSync(startScript, 'utf8').matchAll(/--entrypoint\s+node\s+app\s+(\S+\.js)/g)].map((match) => match[1])
}

function readDockerfileStages(file) {
  const lines = fs.readFileSync(file, 'utf8').replace(/\\\r?\n/g, ' ').split(/\r?\n/)
  const stages = new Map()
  let current = null
  for (const raw of lines) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const [keyword, ...rest] = line.split(/\s+/)
    const instruction = keyword.toUpperCase()
    if (instruction === 'FROM') {
      const asIndex = rest.findIndex((word) => word.toUpperCase() === 'AS')
      current = { base: rest[0], instructions: [] }
      stages.set(asIndex >= 0 ? rest[asIndex + 1] : `#${stages.size}`, current)
    } else if (current) {
      current.instructions.push({ instruction, args: line.slice(keyword.length).trim() })
    }
  }
  return stages
}

function splitArgs(args) {
  return args.startsWith('[') ? JSON.parse(args) : args.split(/\s+/)
}

function globToRegExp(pattern) {
  if (/[[\]\\]/.test(pattern)) throw new Error(`.dockerignore pattern not supported by this test: ${pattern}`)
  let source = ''
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i]
    if (char === '*' && pattern[i + 1] === '*') {
      source += pattern[i + 2] === '/' ? '(?:.*/)?' : '.*'
      i += pattern[i + 2] === '/' ? 2 : 1
    } else if (char === '*') source += '[^/]*'
    else if (char === '?') source += '[^/]'
    else source += char.replace(/[.+^${}()|]/g, '\\$&')
  }
  // A pattern that matches a directory also excludes everything below it.
  return new RegExp(`^${source}(?:/.*)?$`)
}

function readDockerignore(file) {
  if (!fs.existsSync(file)) return () => false
  const rules = fs.readFileSync(file, 'utf8').split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const exclude = !line.startsWith('!')
      const pattern = path.posix.normalize(line.replace(/^!/, '')).replace(/^\/+/, '')
      return { exclude, regexp: globToRegExp(pattern) }
    })
  // As in Docker, the last matching rule decides.
  return (relativePath) => rules.reduce((ignored, rule) => (rule.regexp.test(relativePath) ? rule.exclude : ignored), false)
}

function listFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name)
    return entry.isDirectory() ? listFiles(full) : [full]
  })
}

// A stage built FROM an earlier stage starts with that stage's files.
function stageInstructions(stages, name) {
  const stage = stages.get(name)
  assert.ok(stage, `Dockerfile has no "${name}" stage`)
  return [...(stages.has(stage.base) ? stageInstructions(stages, stage.base) : []), ...stage.instructions]
}

// Maps each file path inside the image to its path in the build context.
function imageFiles(instructions, isIgnored) {
  const files = new Map()
  let workdir = '/'
  let npmInstall = 'none'
  for (const { instruction, args } of instructions) {
    if (instruction === 'WORKDIR') workdir = path.posix.resolve(workdir, args)
    if (instruction === 'RUN' && /\bnpm ci\b/.test(args)) npmInstall = /--omit[= ]dev\b|--production\b/.test(args) ? 'dependencies' : 'all'
    if (instruction !== 'COPY' && instruction !== 'ADD') continue
    const words = splitArgs(args)
    if (words[0].startsWith('--')) throw new Error(`COPY flags are not supported by this test: COPY ${args}`)
    const destination = path.posix.resolve(workdir, words.at(-1))
    const sources = words.slice(0, -1)
    const intoDirectory = sources.length > 1 || words.at(-1).endsWith('/')
    for (const source of sources) {
      const contextPath = path.join(ROOT, source)
      assert.ok(fs.existsSync(contextPath), `Dockerfile copies ${source}, which does not exist`)
      if (fs.statSync(contextPath).isDirectory()) {
        for (const file of listFiles(contextPath)) {
          const relative = path.relative(ROOT, file).split(path.sep).join('/')
          if (isIgnored(relative)) continue
          files.set(path.posix.join(destination, path.relative(contextPath, file).split(path.sep).join('/')), relative)
        }
      } else if (!isIgnored(path.posix.normalize(source))) {
        files.set(intoDirectory ? path.posix.join(destination, path.posix.basename(source)) : destination, path.posix.normalize(source))
      }
    }
  }
  return { files, workdir, npmInstall }
}

// Static import and export declarations start a statement, which keeps route
// strings such as '/api/boards/:id/import' out of the result.
const STATIC_IMPORT = /(?:^|;)[ \t]*(?:import|export)\s*(?:[\w$*{}\s,]+?\s*from\s*)?['"]([^'"]+)['"]/gm
const DYNAMIC_IMPORT = /(?:^|[^\w$.])import\s*\(\s*(['"]?)([^'")\s]*)/g

function importsOf(source) {
  const specifiers = [...source.matchAll(STATIC_IMPORT)].map((match) => match[1])
  for (const match of source.matchAll(DYNAMIC_IMPORT)) {
    if (!match[1]) throw new Error(`a dynamic import without a string literal cannot be checked: import(${match[2]}`)
    specifiers.push(match[2])
  }
  return specifiers
}

function packageName(specifier) {
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

function missingFromImage() {
  const instructions = stageInstructions(readDockerfileStages(path.join(ROOT, 'Dockerfile')), STAGE)
  const { files, workdir, npmInstall } = imageFiles(instructions, readDockerignore(path.join(ROOT, '.dockerignore')))
  const cmd = instructions.findLast(({ instruction }) => instruction === 'CMD')
  assert.ok(cmd, `the "${STAGE}" stage has no CMD`)
  const cmdEntries = splitArgs(cmd.args).filter((word) => word.endsWith('.js'))
  assert.ok(cmdEntries.length > 0, `could not find the script started by CMD ${cmd.args}`)
  const entries = [...cmdEntries, ...startScriptEntries()]

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const installed = new Set([
    ...(npmInstall !== 'none' ? Object.keys(pkg.dependencies || {}) : []),
    ...(npmInstall === 'all' ? Object.keys(pkg.devDependencies || {}) : []),
  ])
  const missing = []
  const visited = new Set()
  let relativeImports = 0
  const queue = entries.map((entry) => ({ imagePath: path.posix.resolve(workdir, entry), importedBy: `${STAGE} stage entry point` }))
  while (queue.length) {
    const { imagePath, importedBy } = queue.shift()
    if (visited.has(imagePath)) continue
    visited.add(imagePath)
    let contextPath = files.get(imagePath)
    if (!contextPath) {
      missing.push(`${path.posix.relative(workdir, imagePath)} (imported by ${importedBy}) is not copied into the image`)
      // Keep following the source file, so one run lists everything missing.
      contextPath = path.posix.relative(workdir, imagePath)
      if (!fs.existsSync(path.join(ROOT, contextPath))) continue
    }
    for (const specifier of importsOf(fs.readFileSync(path.join(ROOT, contextPath), 'utf8'))) {
      if (specifier.startsWith('./') || specifier.startsWith('../')) {
        relativeImports += 1
        queue.push({ imagePath: path.posix.resolve(path.posix.dirname(imagePath), specifier), importedBy: contextPath })
      } else if (isBuiltin(specifier)) {
        continue
      } else if (/^[a-z]+:|^\//i.test(specifier)) {
        missing.push(`${specifier} (imported by ${contextPath}) is an absolute or URL import this test cannot check`)
      } else if (!installed.has(packageName(specifier))) {
        const kind = pkg.devDependencies?.[packageName(specifier)] ? 'a devDependency' : 'not in package.json dependencies'
        missing.push(`package ${packageName(specifier)} (imported by ${contextPath}) is ${kind}; npm ci in the image installs: ${npmInstall}`)
      }
    }
  }
  return { missing, relativeImports }
}

test('the api image contains every module its scripts import', () => {
  const { missing, relativeImports } = missingFromImage()
  assert.ok(relativeImports > 0, 'the check followed no local import; the scanner or the entry points are wrong')
  assert.deepEqual(missing, [], `Add the files to the "${STAGE}" stage in Dockerfile:\n  ${missing.join('\n  ')}`)
})

test('the import scanner sees every import form the server code uses', () => {
  const source = [
    "import express from 'express'",
    "import { a,\n  b } from '../src/multi.js'",
    "export { c } from './re-export.js'",
    "import './side-effect.js'",
    "const lazy = await import('./lazy.js')",
    "res.json({ error: 'import failed' })",
    "app.post('/api/boards/:id/import', (req, res) => {",
    "app.get('/api/boards/:id/export', (req, res) => { res.json({ error: 'x' }) })",
  ].join('\n')
  assert.deepEqual(importsOf(source), ['express', '../src/multi.js', './re-export.js', './side-effect.js', './lazy.js'])
  assert.throws(() => importsOf('await import(name)'), /without a string literal/)
})

test('.dockerignore patterns exclude files and directories as Docker does', () => {
  const matches = (pattern, file) => globToRegExp(pattern).test(file)
  assert.ok(matches('server/*.db', 'server/plainlane.db'))
  assert.ok(matches('data', 'data/plainlane.db'))
  assert.ok(matches('**/*.log', 'server/logs/a.log'))
  assert.ok(!matches('server/*.db', 'server/index.js'))
  assert.ok(!matches('dist', 'src/dist.js'))
})
