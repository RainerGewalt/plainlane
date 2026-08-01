import { test } from 'node:test'
import assert from 'node:assert/strict'
import { subtasksResolved, isDoneMoveAllowed, isSubtaskStatus, subtaskSummary } from '../src/subtasks.js'

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

test('isSubtaskStatus: only the five known statuses are accepted', () => {
  for (const status of ['todo', 'done', 'wont_do', 'question', 'old']) {
    assert.equal(isSubtaskStatus(status), true)
  }
  for (const status of ['garbage', '', null, undefined, 'DONE']) {
    assert.equal(isSubtaskStatus(status), false)
  }
})

test('subtaskSummary: counts done separately from resolved', () => {
  assert.deepEqual(subtaskSummary([]), { doneCount: 0, subtaskCount: 0, completionPct: 100 })
  assert.deepEqual(
    subtaskSummary([{ status: 'done' }, { status: 'wont_do' }, { status: 'todo' }, { status: 'question' }]),
    { doneCount: 1, subtaskCount: 4, completionPct: 75 }
  )
  assert.deepEqual(
    subtaskSummary([{ status: 'todo' }, { status: 'todo' }]),
    { doneCount: 0, subtaskCount: 2, completionPct: 0 }
  )
})

test('isDoneMoveAllowed: a rounded 100 percent does not hide an open subtask', () => {
  // 199 of 200 resolved rounds up to 100 %, but the lone open subtask still blocks Done.
  const subtasks = Array.from({ length: 200 }, (_, index) => ({ status: index === 0 ? 'todo' : 'done' }))
  const card = { subtasks, ...subtaskSummary(subtasks) }
  assert.equal(card.completionPct, 100)
  assert.equal(isDoneMoveAllowed(card), false)
  assert.equal(isDoneMoveAllowed({ subtasks: subtasks.map(() => ({ status: 'done' })) }), true)
})
