const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export function formatLaneAge(changedAt, now = Date.now()) {
  const elapsed = Math.max(0, now - Number(changedAt || now))
  if (elapsed < MINUTE) return 'now'
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m`
  if (elapsed < 2 * DAY) return `${Math.floor(elapsed / HOUR)}h`
  if (elapsed < 14 * DAY) return `${Math.floor(elapsed / DAY)}d`
  if (elapsed < 56 * DAY) return `${Math.floor(elapsed / (7 * DAY))}w`
  if (elapsed < 730 * DAY) return `${Math.floor(elapsed / (30 * DAY))}mo`
  return `${Math.floor(elapsed / (365 * DAY))}y`
}
