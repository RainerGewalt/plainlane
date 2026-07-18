// Group cards by their category for the collapsible in-column sections.
// Pure and framework-free so it can be unit tested in isolation.
//
// Cards without a category fall into the '__none' bucket, which always sorts
// last. Known categories keep the order given by `categoryKeys`; any category
// not in that list follows, in first-seen order.
export const UNCATEGORIZED = '__none'

export function groupByCategory(cards, categoryKeys = []) {
  const map = new Map()
  for (const card of cards) {
    const key = card.category || UNCATEGORIZED
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(card)
  }

  const knownSet = new Set(categoryKeys)
  const known = categoryKeys.filter((k) => map.has(k))
  const extra = [...map.keys()].filter((k) => k !== UNCATEGORIZED && !knownSet.has(k))
  const ordered = [...known, ...extra]
  if (map.has(UNCATEGORIZED)) ordered.push(UNCATEGORIZED)

  return ordered.map((key) => ({ key, cards: map.get(key) }))
}
