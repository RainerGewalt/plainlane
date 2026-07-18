import { test } from 'node:test'
import assert from 'node:assert/strict'
import { groupByCategory, UNCATEGORIZED } from '../src/grouping.js'

const CATEGORY_ORDER = ['general', 'idea', 'admin', 'finance', 'important']

test('groups cards by category', () => {
  const cards = [
    { id: 'a', category: 'admin' },
    { id: 'b', category: 'general' },
    { id: 'c', category: 'admin' },
  ]
  const groups = groupByCategory(cards, CATEGORY_ORDER)
  const admin = groups.find((g) => g.key === 'admin')
  assert.deepEqual(admin.cards.map((c) => c.id), ['a', 'c'])
})

test('keeps the supplied category order', () => {
  const cards = [
    { id: '1', category: 'admin' },
    { id: '2', category: 'general' },
    { id: '3', category: 'idea' },
  ]
  const keys = groupByCategory(cards, CATEGORY_ORDER).map((g) => g.key)
  assert.deepEqual(keys, ['general', 'idea', 'admin'])
})

test('unknown categories follow known ones in first-seen order', () => {
  const cards = [
    { id: '1', category: 'zeta' },
    { id: '2', category: 'general' },
    { id: '3', category: 'alpha' },
  ]
  const keys = groupByCategory(cards, CATEGORY_ORDER).map((g) => g.key)
  assert.deepEqual(keys, ['general', 'zeta', 'alpha'])
})

test('cards without a category go into the uncategorized bucket, always last', () => {
  const cards = [
    { id: '1', category: '' },
    { id: '2', category: null },
    { id: '3', category: 'general' },
    { id: '4' },
  ]
  const groups = groupByCategory(cards, CATEGORY_ORDER)
  assert.equal(groups[groups.length - 1].key, UNCATEGORIZED)
  assert.deepEqual(
    groups.find((g) => g.key === UNCATEGORIZED).cards.map((c) => c.id),
    ['1', '2', '4']
  )
})

test('only returns categories that actually have cards', () => {
  const groups = groupByCategory([{ id: '1', category: 'idea' }], CATEGORY_ORDER)
  assert.deepEqual(groups.map((g) => g.key), ['idea'])
})

test('empty input yields no groups', () => {
  assert.deepEqual(groupByCategory([], CATEGORY_ORDER), [])
})
