/**
 * API client for the listing-search backend.
 *
 * The Vite dev server proxies /api/* to the FastAPI server on :8000
 * (see vite.config.ts), so all calls go through /api.
 */

export interface ScoreBreakdown {
  /** 0-1 budget fit; null when no targetBudget was given. */
  budgetFit: number | null
  /** 0-1 recency score (30-day half-life). */
  recency: number
  /** Days since listed; null if the date was missing/unparseable. */
  ageDays: number | null
}

export interface SearchItem {
  property_id: string
  source: string
  address: string
  city: string
  state: string
  zip: string
  price: number
  bedrooms: number
  bathrooms: number
  sqft: number | null
  latitude: number
  longitude: number
  listedDate: string | null
  status: string
  description: string | null
  /** Relevance score, 0-100. */
  score: number
  scoreBreakdown: ScoreBreakdown
}

export interface RankingInfo {
  mode: 'budget+recency' | 'recency-only'
  budgetWeight: number
  recencyWeight: number
  halfLifeDays: number
}

export interface SearchResponse {
  items: SearchItem[]
  page: number
  pageSize: number
  total: number
  totalPages: number
  hasNext: boolean
  hasPrev: boolean
  ranking: RankingInfo
}

/** Validated, ready-to-send search filters (page is tracked separately). */
export interface SearchFilters {
  minPrice?: number
  maxPrice?: number
  minBedrooms?: number
  city?: string
  keyword?: string
  targetBudget?: number
  pageSize: number
}

/** A single field-level validation problem, either client- or server-side. */
export interface FieldError {
  field: string
  message: string
}

/** Error thrown for any failed search request. */
export class SearchApiError extends Error {
  readonly status: number
  /** Populated when the server rejected input with a 422. */
  readonly fieldErrors: FieldError[]

  constructor(message: string, status: number, fieldErrors: FieldError[] = []) {
    super(message)
    this.name = 'SearchApiError'
    this.status = status
    this.fieldErrors = fieldErrors
  }
}

interface ServerDetailEntry {
  loc?: unknown[]
  msg?: string
}

/** Parse FastAPI's uniform 422 shape into field-level errors. */
function parseValidationDetail(detail: unknown): FieldError[] {
  if (!Array.isArray(detail)) return []
  return detail
    .filter((entry): entry is ServerDetailEntry => typeof entry === 'object' && entry !== null)
    .map((entry) => {
      const field = Array.isArray(entry.loc) ? String(entry.loc[entry.loc.length - 1]) : 'query'
      return { field, message: entry.msg ?? 'Invalid value.' }
    })
}

export async function searchProperties(
  filters: SearchFilters,
  page: number,
  signal?: AbortSignal,
): Promise<SearchResponse> {
  const params = new URLSearchParams()
  if (filters.minPrice !== undefined) params.set('minPrice', String(filters.minPrice))
  if (filters.maxPrice !== undefined) params.set('maxPrice', String(filters.maxPrice))
  if (filters.minBedrooms !== undefined) params.set('minBedrooms', String(filters.minBedrooms))
  if (filters.city) params.set('city', filters.city)
  if (filters.keyword) params.set('keyword', filters.keyword)
  if (filters.targetBudget !== undefined) params.set('targetBudget', String(filters.targetBudget))
  params.set('page', String(page))
  params.set('pageSize', String(filters.pageSize))

  let response: Response
  try {
    response = await fetch(`/api/properties/search?${params.toString()}`, { signal })
  } catch {
    // Includes network failures and request aborts.
    throw new SearchApiError(
      'Could not reach the listing service. Check your connection and try again.',
      0,
    )
  }

  if (!response.ok) {
    let detail: unknown = null
    try {
      const body = await response.json()
      detail = body?.detail ?? null
    } catch {
      // Non-JSON error body; fall through to the generic message.
    }

    if (response.status === 422) {
      throw new SearchApiError(
        'Some search values were rejected by the server.',
        422,
        parseValidationDetail(detail),
      )
    }
    const message =
      typeof detail === 'string' && detail
        ? detail
        : `The listing service returned an error (HTTP ${response.status}).`
    throw new SearchApiError(message, response.status)
  }

  return (await response.json()) as SearchResponse
}

export async function fetchCities(): Promise<string[]> {
  let response: Response
  try {
    response = await fetch('/api/properties/cities')
  } catch {
    throw new SearchApiError('Could not reach the listing service to load cities.', 0)
  }
  if (!response.ok) {
    throw new SearchApiError(`Failed to load cities (HTTP ${response.status}).`, response.status)
  }
  const body = (await response.json()) as { cities: string[] }
  return body.cities
}
