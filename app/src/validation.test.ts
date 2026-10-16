import { describe, expect, it } from 'vitest'
import {
  EMPTY_DRAFT,
  countActiveFilters,
  draftToFilters,
  serverErrorsToDraft,
  validateDraft,
} from './validation'
import type { SearchDraft } from './validation'

function draft(overrides: Partial<SearchDraft> = {}): SearchDraft {
  return { ...EMPTY_DRAFT, ...overrides }
}

describe('validateDraft', () => {
  it('accepts an empty draft (all filters optional)', () => {
    expect(validateDraft(draft())).toEqual({})
  })

  it('accepts a fully specified valid draft', () => {
    const errors = validateDraft(
      draft({
        minPrice: '300000',
        maxPrice: '600000',
        minBedrooms: '2',
        city: 'Fairfax',
        keyword: 'pool',
        targetBudget: '500000',
        pageSize: '25',
      }),
    )
    expect(errors).toEqual({})
  })

  it('rejects minPrice greater than maxPrice', () => {
    const errors = validateDraft(draft({ minPrice: '600000', maxPrice: '400000' }))
    expect(errors.minPrice).toMatch(/cannot be greater than maximum price/)
    expect(errors.maxPrice).toBeUndefined()
  })

  it('allows minPrice equal to maxPrice', () => {
    expect(validateDraft(draft({ minPrice: '500000', maxPrice: '500000' }))).toEqual({})
  })

  it('rejects non-numeric money values', () => {
    const errors = validateDraft(draft({ minPrice: 'abc', maxPrice: '$100' }))
    expect(errors.minPrice).toMatch(/must be a number/)
    expect(errors.maxPrice).toMatch(/must be a number/)
  })

  it('rejects negative money values', () => {
    const errors = validateDraft(draft({ minPrice: '-5', targetBudget: '-1' }))
    expect(errors.minPrice).toMatch(/cannot be negative/)
    expect(errors.targetBudget).toMatch(/cannot be negative/)
  })

  it('rejects a zero target budget', () => {
    const errors = validateDraft(draft({ targetBudget: '0' }))
    expect(errors.targetBudget).toMatch(/greater than zero/)
  })

  it('rejects non-integer bedrooms', () => {
    expect(validateDraft(draft({ minBedrooms: '2.5' })).minBedrooms).toMatch(/whole number/)
  })

  it('rejects bedrooms outside 0-20', () => {
    expect(validateDraft(draft({ minBedrooms: '21' })).minBedrooms).toMatch(/between 0 and 20/)
    expect(validateDraft(draft({ minBedrooms: '-1' })).minBedrooms).toMatch(/between 0 and 20/)
  })

  it('rejects an overlong keyword', () => {
    const errors = validateDraft(draft({ keyword: 'x'.repeat(101) }))
    expect(errors.keyword).toMatch(/100 characters or fewer/)
  })

  it('allows a keyword exactly at the limit', () => {
    expect(validateDraft(draft({ keyword: 'x'.repeat(100) }))).toEqual({})
  })

  it('rejects an invalid pageSize', () => {
    expect(validateDraft(draft({ pageSize: '0' })).pageSize).toMatch(/between 1 and 50/)
    expect(validateDraft(draft({ pageSize: '51' })).pageSize).toMatch(/between 1 and 50/)
    expect(validateDraft(draft({ pageSize: 'lots' })).pageSize).toMatch(/between 1 and 50/)
  })
})

describe('draftToFilters', () => {
  it('converts an empty draft to only a pageSize', () => {
    expect(draftToFilters(draft())).toEqual({ pageSize: 10 })
  })

  it('trims whitespace and parses numbers', () => {
    const filters = draftToFilters(
      draft({ minPrice: ' 300000 ', minBedrooms: ' 2 ', keyword: ' pool ', city: ' Fairfax ' }),
    )
    expect(filters).toEqual({
      minPrice: 300000,
      minBedrooms: 2,
      keyword: 'pool',
      city: 'Fairfax',
      pageSize: 10,
    })
  })

  it('treats blank strings as unset', () => {
    const filters = draftToFilters(
      draft({ minPrice: '   ', city: '', keyword: '  ', targetBudget: '' }),
    )
    expect(filters.minPrice).toBeUndefined()
    expect(filters.city).toBeUndefined()
    expect(filters.keyword).toBeUndefined()
    expect(filters.targetBudget).toBeUndefined()
  })

  it('falls back to page size 10 when pageSize is unusable', () => {
    expect(draftToFilters(draft({ pageSize: 'nope' })).pageSize).toBe(10)
  })
})

describe('countActiveFilters', () => {
  it('counts each set filter', () => {
    expect(countActiveFilters(draftToFilters(draft()))).toBe(0)
    expect(
      countActiveFilters(
        draftToFilters(draft({ minPrice: '1', maxPrice: '2', city: 'X', targetBudget: '3' })),
      ),
    ).toBe(4)
  })
})

describe('serverErrorsToDraft', () => {
  it('maps known server fields onto draft fields', () => {
    const mapped = serverErrorsToDraft([
      { field: 'minPrice', message: 'minPrice cannot be greater than maxPrice.' },
      { field: 'keyword', message: 'keyword must be 100 characters or fewer.' },
    ])
    expect(mapped).toEqual({
      minPrice: 'minPrice cannot be greater than maxPrice.',
      keyword: 'keyword must be 100 characters or fewer.',
    })
  })

  it('ignores fields that are not part of the form', () => {
    expect(serverErrorsToDraft([{ field: 'page', message: 'too small' }])).toEqual({ page: 'too small' })
    expect(serverErrorsToDraft([{ field: 'other', message: '???' }])).toEqual({})
  })
})
