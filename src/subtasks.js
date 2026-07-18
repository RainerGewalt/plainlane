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

export function subtasksResolved(subtasks = []) {
  return subtasks.every((subtask) => subtask.status !== 'todo')
}

// A card may only enter the Done lane when it has no unresolved subtasks.
// Cards without subtasks are always allowed.
export function isDoneMoveAllowed(card) {
  if (!card || (card.subtaskCount || 0) === 0) return true
  return (card.completionPct ?? 100) >= 100
}
