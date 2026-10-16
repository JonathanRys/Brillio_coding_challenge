import { afterEach, describe, expect, it, vi } from 'vitest'
import { SearchApiError, fetchCities, searchProperties } from './api'
import type { SearchFilters } from './api'

const BASE_FILTERS: SearchFilters = { pageSize: 10 }

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('searchProperties', () => {
  it('builds a query string from filters and page', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await searchProperties(
      {
        minPrice: 300000,
        maxPrice: 600000,
        minBedrooms: 2,
        city: 'Fairfax',
        keyword: 'pool',
        targetBudget: 500000,
        pageSize: 25,
      },
      3,
    )

    const url = String(fetchMock.mock.calls[0][0])
    const params = new URLSearchParams(url.split('?')[1])
    expect(url.startsWith('/api/properties/search?')).toBe(true)
    expect(params.get('minPrice')).toBe('300000')
    expect(params.get('maxPrice')).toBe('600000')
    expect(params.get('minBedrooms')).toBe('2')
    expect(params.get('city')).toBe('Fairfax')
    expect(params.get('keyword')).toBe('pool')
    expect(params.get('targetBudget')).toBe('500000')
    expect(params.get('page')).toBe('3')
    expect(params.get('pageSize')).toBe('25')
  })

  it('omits unset filters from the query string', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await searchProperties(BASE_FILTERS, 1)

    const params = new URLSearchParams(String(fetchMock.mock.calls[0][0]).split('?')[1])
    expect([...params.keys()].sort()).toEqual(['page', 'pageSize'])
  })

  it('returns the parsed response body on success', async () => {
    const body = { items: [], total: 0, page: 1, pageSize: 10, totalPages: 0 }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(body)))

    await expect(searchProperties(BASE_FILTERS, 1)).resolves.toEqual(body)
  })

  it('parses 422 detail into field errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            detail: [
              {
                loc: ['query', 'minPrice'],
                msg: 'minPrice (500000) cannot be greater than maxPrice (100000).',
                type: 'value_error',
              },
            ],
          },
          422,
        ),
      ),
    )

    const error = await searchProperties(BASE_FILTERS, 1).catch((e) => e)
    expect(error).toBeInstanceOf(SearchApiError)
    expect(error.status).toBe(422)
    expect(error.fieldErrors).toEqual([
      { field: 'minPrice', message: 'minPrice (500000) cannot be greater than maxPrice (100000).' },
    ])
  })

  it('uses the server detail string for non-422 errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ detail: 'The listing database is unavailable.' }, 503)),
    )

    const error = await searchProperties(BASE_FILTERS, 1).catch((e) => e)
    expect(error).toBeInstanceOf(SearchApiError)
    expect(error.status).toBe(503)
    expect(error.message).toContain('unavailable')
    expect(error.fieldErrors).toEqual([])
  })

  it('falls back to a generic message for non-JSON errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error('not json')
        },
      } as unknown as Response),
    )

    const error = await searchProperties(BASE_FILTERS, 1).catch((e) => e)
    expect(error.status).toBe(500)
    expect(error.message).toContain('HTTP 500')
  })

  it('wraps network failures in a friendly SearchApiError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    const error = await searchProperties(BASE_FILTERS, 1).catch((e) => e)
    expect(error).toBeInstanceOf(SearchApiError)
    expect(error.status).toBe(0)
    expect(error.message).toMatch(/could not reach/i)
  })

  it('forwards the abort signal to fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()

    await searchProperties(BASE_FILTERS, 1, controller.signal)
    expect(fetchMock.mock.calls[0][1]).toEqual({ signal: controller.signal })
  })
})

describe('fetchCities', () => {
  it('returns the cities list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ cities: ['Fairfax', 'Reston'] })),
    )
    await expect(fetchCities()).resolves.toEqual(['Fairfax', 'Reston'])
  })

  it('throws a SearchApiError on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 500)))
    const error = await fetchCities().catch((e) => e)
    expect(error).toBeInstanceOf(SearchApiError)
    expect(error.status).toBe(500)
  })

  it('wraps network failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('down')))
    const error = await fetchCities().catch((e) => e)
    expect(error).toBeInstanceOf(SearchApiError)
    expect(error.status).toBe(0)
  })
})
