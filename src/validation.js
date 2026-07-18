// Pure validation rules for the board editor, kept separate so they are easy to
// read, reuse, and unit test without rendering the form.
export const BOARD_NAME_MAX = 60
export const SUBTASK_LIMIT_MIN = 1
export const SUBTASK_LIMIT_MAX = 10

export function validateBoard(values) {
  const errors = {}

  const name = (values.name || '').trim()
  if (!name) errors.name = 'Please enter a board name.'
  else if (name.length > BOARD_NAME_MAX) errors.name = `Use ${BOARD_NAME_MAX} characters or fewer.`

  if (!(values.emoji || '').trim()) errors.emoji = 'Pick an icon.'

  const limit = Number(values.subtaskLimit)
  if (!Number.isInteger(limit) || limit < SUBTASK_LIMIT_MIN || limit > SUBTASK_LIMIT_MAX) {
    errors.subtaskLimit = `Choose a whole number from ${SUBTASK_LIMIT_MIN} to ${SUBTASK_LIMIT_MAX}.`
  }

  return errors
}
