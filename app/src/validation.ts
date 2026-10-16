/**
 * Client-side validation for the search form.
 *
 * These rules deliberately mirror the server's (see server/main.py) so most
 * bad input is caught inline before a request is ever made — the server
 * still validates independently, and its 422s are surfaced as field errors
 * if anything slips through.
 */

import type { FieldError, SearchFilters } from './api'

/** Raw form draft; every field is a string so the inputs stay controlled. */
export interface SearchDraft {
  minPrice: string
  maxPrice: string
  minBedrooms: string
  city: string
  keyword: string
  targetBudget: string
  pageSize: string
}

export const EMPTY_DRAFT: SearchDraft = {
  minPrice: '',
  maxPrice: '',
  minBedrooms: '',
  city: '',
  keyword: '',
  targetBudget: '',
  pageSize: '10',
}

/** Page sizes the UI offers; the server enforces 1-50 regardless. */
export const PAGE_SIZE_OPTIONS = [10, 25, 50]

export const MAX_KEYWORD_LENGTH = 100

/** Convert a trimmed draft into the query params object (undefined = unset). */
export function draftToFilters(draft: SearchDraft): SearchFilters {
  const num = (value: string): number | undefined => {
    const trimmed = value.trim()
    if (trimmed === '') return undefined
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return {
    minPrice: num(draft.minPrice),
    maxPrice: num(draft.maxPrice),
    minBedrooms: num(draft.minBedrooms),
    city: draft.city.trim() || undefined,
    keyword: draft.keyword.trim() || undefined,
    targetBudget: num(draft.targetBudget),
    pageSize: num(draft.pageSize) ?? 10,
  }
}

/**
 * Validate a draft. Returns field errors keyed by draft field; an empty
 * object means the draft is safe to submit.
 */
export function validateDraft(draft: SearchDraft): Record<string, string> {
  const errors: Record<string, string> = {}

  const checkMoney = (field: 'minPrice' | 'maxPrice' | 'targetBudget', label: string) => {
    const raw = draft[field].trim()
    if (raw === '') return undefined
    const value = Number(raw)
    if (!Number.isFinite(value)) {
      errors[field] = `${label} must be a number.`
      return undefined
    }
    if (value < 0) {
      errors[field] = `${label} cannot be negative.`
      return undefined
    }
    return value
  }

  const minPrice = checkMoney('minPrice', 'Minimum price')
  const maxPrice = checkMoney('maxPrice', 'Maximum price')
  const targetBudget = checkMoney('targetBudget', 'Target budget')

  // Cross-field: the range has to make sense.
  if (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice) {
    errors.minPrice = `Minimum price cannot be greater than maximum price (${formatPlain(maxPrice)}).`
  }
  if (targetBudget === 0) {
    errors.targetBudget = 'Target budget must be greater than zero.'
  }

  const bedroomsRaw = draft.minBedrooms.trim()
  if (bedroomsRaw !== '') {
    const bedrooms = Number(bedroomsRaw)
    if (!Number.isInteger(bedrooms) || bedrooms < 0 || bedrooms > 20) {
      errors.minBedrooms = 'Bedrooms must be a whole number between 0 and 20.'
    }
  }

  const keyword = draft.keyword.trim()
  if (keyword.length > MAX_KEYWORD_LENGTH) {
    errors.keyword = `Keyword must be ${MAX_KEYWORD_LENGTH} characters or fewer (currently ${keyword.length}).`
  }

  const pageSize = Number(draft.pageSize)
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) {
    errors.pageSize = 'Results per page must be between 1 and 50.'
  }

  return errors
}

/** Map server 422 field errors (server field names) onto draft fields. */
export function serverErrorsToDraft(serverErrors: FieldError[]): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const { field, message } of serverErrors) {
    if (!(field in EMPTY_DRAFT) && field !== 'page') continue
    errors[field] = message
  }
  return errors
}

function formatPlain(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)
}

/** Count how many filters are active (used for the "clear" affordances). */
export function countActiveFilters(filters: SearchFilters): number {
  let count = 0
  if (filters.minPrice !== undefined) count++
  if (filters.maxPrice !== undefined) count++
  if (filters.minBedrooms !== undefined) count++
  if (filters.city) count++
  if (filters.keyword) count++
  if (filters.targetBudget !== undefined) count++
  return count
}

export type { FieldError, SearchFilters }
