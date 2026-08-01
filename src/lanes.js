// The three Plainlane lanes. Framework-free so the client, the server, and unit
// tests all agree on which lanes exist and what they are called.

export const LANES = [
  { id: 'todo', title: 'To Do' },
  { id: 'progress', title: 'In Progress' },
  { id: 'done', title: 'Done' },
]

export const LANE_IDS = LANES.map((lane) => lane.id)
export const LANE_LABELS = Object.fromEntries(LANES.map((lane) => [lane.id, lane.title]))
export const DEFAULT_LANE = 'todo'

export function isLaneId(value) {
  return LANE_IDS.includes(value)
}

export function laneLabel(value) {
  return LANE_LABELS[value] || value
}
