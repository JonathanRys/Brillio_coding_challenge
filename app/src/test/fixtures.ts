/** Shared test fixtures for the frontend suite. */

import type { RankingInfo, SearchItem, SearchResponse } from '../api'

/** Build a complete SearchItem with sensible defaults. */
export function makeItem(overrides: Partial<SearchItem> = {}): SearchItem {
  return {
    property_id: 'T1',
    source: 'MLS_A',
    address: '1 First St',
    city: 'Springfield',
    state: 'VA',
    zip: '22150',
    price: 500000,
    bedrooms: 3,
    bathrooms: 2,
    sqft: 1200,
    latitude: 38.8,
    longitude: -77.2,
    listedDate: '2026-10-01',
    status: 'active',
    description: 'Renovated kitchen with quartz counters.',
    score: 95.9,
    scoreBreakdown: { budgetFit: 0.969, recency: 0.936, ageDays: 3 },
    ...overrides,
  }
}

export const BUDGET_RANKING: RankingInfo = {
  mode: 'budget+recency',
  budgetWeight: 0.7,
  recencyWeight: 0.3,
  halfLifeDays: 30,
}

export const RECENCY_RANKING: RankingInfo = {
  mode: 'recency-only',
  budgetWeight: 0,
  recencyWeight: 1,
  halfLifeDays: 30,
}

/** Build a SearchResponse with sensible defaults. */
export function makeResponse(overrides: Partial<SearchResponse> = {}): SearchResponse {
  const items = overrides.items ?? [makeItem()]
  const pageSize = overrides.pageSize ?? 10
  const total = overrides.total ?? items.length
  const totalPages = overrides.totalPages ?? (total ? Math.ceil(total / pageSize) : 0)
  return {
    items,
    page: overrides.page ?? 1,
    pageSize,
    total,
    totalPages,
    hasNext: overrides.hasNext ?? false,
    hasPrev: overrides.hasPrev ?? false,
    ranking: overrides.ranking ?? BUDGET_RANKING,
  }
}
