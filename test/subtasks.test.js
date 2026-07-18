import { test } from 'node:test'
import assert from 'node:assert/strict'
import { subtasksResolved, isDoneMoveAllowed } from '../src/subtasks.js'

test('subtasksResolved: empty list counts as resolved', () => {
  assert.equal(subtasksResolved([]), true)
  assert.equal(subtasksResolved(undefined), true)
})

test('subtasksResolved: true only when nothing is still todo', () => {
  assert.equal(subtasksResolved([{ status: 'done' }, { status: 'wont_do' }]), true)
  assert.equal(subtasksResolved([{ status: 'done' }, { status: 'question' }, { status: 'old' }]), true)
  assert.equal(subtasksResolved([{ status: 'done' }, { status: 'todo' }]), false)
  assert.equal(subtasksResolved([{ status: 'todo' }]), false)
})

test('isDoneMoveAllowed: cards without subtasks may always move to done', () => {
  assert.equal(isDoneMoveAllowed({ subtaskCount: 0 }), true)
  assert.equal(isDoneMoveAllowed({}), true)
  assert.equal(isDoneMoveAllowed(null), true)
})

test('isDoneMoveAllowed: blocked while subtasks are unresolved', () => {
  assert.equal(isDoneMoveAllowed({ subtaskCount: 4, completionPct: 100 }), true)
  assert.equal(isDoneMoveAllowed({ subtaskCount: 4, completionPct: 75 }), false)
  assert.equal(isDoneMoveAllowed({ subtaskCount: 2, completionPct: 0 }), false)
})
