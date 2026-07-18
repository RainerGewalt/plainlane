import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateBoard, BOARD_NAME_MAX } from '../src/validation.js'

const valid = { name: 'Home', emoji: '🏠', subtaskLimit: '5', progressLimit: '' }

test('accepts a well-formed board', () => {
  assert.deepEqual(validateBoard(valid), {})
})

test('requires a non-empty name', () => {
  assert.equal(validateBoard({ ...valid, name: '   ' }).name, 'Please enter a board name.')
  assert.ok(validateBoard({ ...valid, name: '' }).name)
})

test('rejects an over-long name', () => {
  const long = 'x'.repeat(BOARD_NAME_MAX + 1)
  assert.ok(validateBoard({ ...valid, name: long }).name)
  const exact = 'x'.repeat(BOARD_NAME_MAX)
  assert.equal(validateBoard({ ...valid, name: exact }).name, undefined)
})

test('requires an icon', () => {
  assert.equal(validateBoard({ ...valid, emoji: '' }).emoji, 'Pick an icon.')
})

test('subtask limit must be a whole number from 1 to 10', () => {
  assert.ok(validateBoard({ ...valid, subtaskLimit: '0' }).subtaskLimit)
  assert.ok(validateBoard({ ...valid, subtaskLimit: '11' }).subtaskLimit)
  assert.ok(validateBoard({ ...valid, subtaskLimit: '3.5' }).subtaskLimit)
  assert.ok(validateBoard({ ...valid, subtaskLimit: 'abc' }).subtaskLimit)
  assert.equal(validateBoard({ ...valid, subtaskLimit: '1' }).subtaskLimit, undefined)
  assert.equal(validateBoard({ ...valid, subtaskLimit: '10' }).subtaskLimit, undefined)
})

test('In Progress limit is optional and otherwise a positive whole number', () => {
  assert.equal(validateBoard({ ...valid, progressLimit: '' }).progressLimit, undefined)
  assert.equal(validateBoard({ ...valid, progressLimit: '1' }).progressLimit, undefined)
  assert.equal(validateBoard({ ...valid, progressLimit: '999' }).progressLimit, undefined)
  assert.ok(validateBoard({ ...valid, progressLimit: '0' }).progressLimit)
  assert.ok(validateBoard({ ...valid, progressLimit: '1000' }).progressLimit)
  assert.ok(validateBoard({ ...valid, progressLimit: '2.5' }).progressLimit)
  assert.ok(validateBoard({ ...valid, progressLimit: 'many' }).progressLimit)
})

test('reports several problems at once', () => {
  const errors = validateBoard({ name: '', emoji: '', subtaskLimit: '99', progressLimit: '0' })
  assert.deepEqual(Object.keys(errors).sort(), ['emoji', 'name', 'progressLimit', 'subtaskLimit'])
})
