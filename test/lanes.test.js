import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LANES, LANE_IDS, LANE_LABELS, isLaneId, laneLabel } from '../src/lanes.js'

test('the board keeps exactly three lanes', () => {
  assert.deepEqual(LANE_IDS, ['todo', 'progress', 'done'])
  assert.equal(LANES.length, 3)
})

test('only the three lane ids are accepted', () => {
  for (const id of LANE_IDS) assert.equal(isLaneId(id), true)
  for (const value of ['nonsense', '', null, undefined, 'TODO', 'Done']) {
    assert.equal(isLaneId(value), false)
  }
})

test('lane labels are readable and fall back to the raw value', () => {
  assert.equal(LANE_LABELS.progress, 'In Progress')
  assert.equal(laneLabel('done'), 'Done')
  assert.equal(laneLabel('legacy'), 'legacy')
})
