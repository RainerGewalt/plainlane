import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatLaneAge } from '../src/laneAge.js'

const minute = 60 * 1000
const hour = 60 * minute
const day = 24 * hour
const now = 2_000_000_000_000

test('formats short lane ages compactly', () => {
  assert.equal(formatLaneAge(now, now), 'now')
  assert.equal(formatLaneAge(now - 7 * minute, now), '7m')
  assert.equal(formatLaneAge(now - 5 * hour, now), '5h')
  assert.equal(formatLaneAge(now - 6 * day, now), '6d')
})

test('uses weeks, months, and years for older lane ages', () => {
  assert.equal(formatLaneAge(now - 21 * day, now), '3w')
  assert.equal(formatLaneAge(now - 90 * day, now), '3mo')
  assert.equal(formatLaneAge(now - 800 * day, now), '2y')
})

test('does not show a negative age for future or missing timestamps', () => {
  assert.equal(formatLaneAge(now + hour, now), 'now')
  assert.equal(formatLaneAge(null, now), 'now')
})
