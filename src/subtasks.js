// Single source of truth for subtask statuses and the rules derived from them.
// Framework-free so it can be shared by the client, the server, and unit tests.

export const SUBTASK_STATUSES = {
  todo: '○ To do',
  done: '✓ Done',
  wont_do: '✗ Won\'t do',
  question: '❓ Question',
  old: '⏱ Old',
}

// Order used when cycling a subtask through its statuses.
export const SUBTASK_STATUS_ORDER = ['todo', 'done', 'wont_do', 'question', 'old']

// A subtask is "resolved" once it leaves 'todo' — i.e. it reached any end state
// (done / won't do / question / old).
export const FINAL_SUBTASK_STATUSES = ['done', 'wont_do', 'question', 'old']

export function isSubtaskStatus(value) {
  return SUBTASK_STATUS_ORDER.includes(value)
}

export function subtasksResolved(subtasks = []) {
  return subtasks.every((subtask) => subtask.status !== 'todo')
}

// Completion figures shown on cards and used by the Done guard. Kept here so the
// server and the optimistic client updates can never drift apart.
export function subtaskSummary(subtasks = []) {
  const finalCount = subtasks.filter((subtask) => FINAL_SUBTASK_STATUSES.includes(subtask.status)).length
  return {
    doneCount: subtasks.filter((subtask) => subtask.status === 'done').length,
    subtaskCount: subtasks.length,
    completionPct: subtasks.length > 0 ? Math.round((finalCount / subtasks.length) * 100) : 100,
  }
}

// A card may only enter the Done lane when it has no unresolved subtasks.
// Cards without subtasks are always allowed. The loaded subtask list is checked
// directly when available, so the client applies exactly the rule the server
// enforces — a rounded percentage could read 100 while one subtask is still open.
export function isDoneMoveAllowed(card) {
  if (!card) return true
  if (Array.isArray(card.subtasks)) return subtasksResolved(card.subtasks)
  if ((card.subtaskCount || 0) === 0) return true
  return (card.completionPct ?? 100) >= 100
}
