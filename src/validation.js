// Pure validation rules for the board editor, kept separate so they are easy to
// read, reuse, and unit test without rendering the form.
export const BOARD_NAME_MAX = 60
export const SUBTASK_LIMIT_MIN = 1
export const SUBTASK_LIMIT_MAX = 10
export const PROGRESS_LIMIT_MIN = 1
export const PROGRESS_LIMIT_MAX = 999

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

  const progressLimitValue = String(values.progressLimit ?? '').trim()
  if (progressLimitValue) {
    const progressLimit = Number(progressLimitValue)
    if (!Number.isInteger(progressLimit) || progressLimit < PROGRESS_LIMIT_MIN || progressLimit > PROGRESS_LIMIT_MAX) {
      errors.progressLimit = `Leave empty or choose a whole number from ${PROGRESS_LIMIT_MIN} to ${PROGRESS_LIMIT_MAX}.`
    }
  }

  return errors
}
