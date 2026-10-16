import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { makeItem, makeResponse } from './test/fixtures'

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

interface FetchOptions {
  cities?: string[]
  /** Custom search handler; receives parsed params and the 1-based call index. */
  search?: (params: URLSearchParams, callIndex: number) => Response
}

/**
 * Install a fetch mock that routes /api/properties/search and
 * /api/properties/cities, recording every search call's params.
 */
function installFetch(options: FetchOptions = {}) {
  const searchCalls: URLSearchParams[] = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.startsWith('/api/properties/cities')) {
      return jsonResponse({ cities: options.cities ?? ['Fairfax', 'Reston'] })
    }
    if (url.startsWith('/api/properties/search')) {
      const params = new URLSearchParams(url.split('?')[1])
      searchCalls.push(params)
      const callIndex = searchCalls.length
      if (options.search) return options.search(params, callIndex)
      return jsonResponse(makeResponse())
    }
    throw new Error(`Unexpected URL: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return { searchCalls, fetchMock }
}

function renderApp() {
  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('App — loading and results', () => {
  it('shows a loading skeleton, then the ranked results', async () => {
    installFetch()
    renderApp()

    // Initial pending state.
    expect(screen.getByRole('status')).toBeInTheDocument()

    // Results replace the skeleton.
    expect(await screen.findByText('1 First St')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByText('$500,000')).toBeInTheDocument()
    expect(screen.getByText('95.9')).toBeInTheDocument()
    expect(screen.getByText(/1 matching listing/)).toBeInTheDocument()
  })

  it('explains the ranking mode returned by the server', async () => {
    installFetch()
    renderApp()
    await screen.findByText('1 First St')
    const note = document.querySelector('.ranking-note')
    expect(note).toHaveTextContent('70% budget fit + 30% recency')
    expect(note).toHaveTextContent('30 days')
  })

  it('explains recency-only mode differently', async () => {
    installFetch({
      search: () => jsonResponse(makeResponse({ ranking: {
        mode: 'recency-only', budgetWeight: 0, recencyWeight: 1, halfLifeDays: 30,
      } })),
    })
    renderApp()
    await screen.findByText('1 First St')
    const note = document.querySelector('.ranking-note')
    expect(note).toHaveTextContent(/Ranked by recency only/)
  })

  it('populates the city dropdown from the cities endpoint', async () => {
    installFetch()
    renderApp()
    await screen.findByText('1 First St')
    fireEvent.mouseDown(screen.getByLabelText('City'))
    expect(screen.getByRole('option', { name: 'Fairfax' })).toBeInTheDocument()
  })
})

describe('App — form validation', () => {
  it('blocks submitting min > max and shows inline errors without a search call', async () => {
    const user = userEvent.setup()
    const { searchCalls } = installFetch()
    renderApp()
    await screen.findByText('1 First St')
    const initialCalls = searchCalls.length

    await user.type(screen.getByLabelText('Min price'), '600000')
    await user.type(screen.getByLabelText('Max price'), '400000')
    // Editing the draft alone must never trigger a search.
    expect(searchCalls.length).toBe(initialCalls)

    await user.click(screen.getByRole('button', { name: 'Search listings' }))
    expect(
      await screen.findByText(/Minimum price cannot be greater than maximum price/),
    ).toBeInTheDocument()
    expect(searchCalls.length).toBe(initialCalls) // no request fired
  })

  it('clears a field error as soon as the user edits that field', async () => {
    const user = userEvent.setup()
    installFetch()
    renderApp()
    await screen.findByText('1 First St')

    await user.type(screen.getByLabelText('Min price'), '600000')
    await user.type(screen.getByLabelText('Max price'), '400000')
    await user.click(screen.getByRole('button', { name: 'Search listings' }))
    expect(await screen.findByText(/cannot be greater than/)).toBeInTheDocument()

    // Backspace over the bad min price -> error disappears immediately.
    await user.clear(screen.getByLabelText('Min price'))
    expect(screen.queryByText(/cannot be greater than/)).not.toBeInTheDocument()
  })

  it('surfaces server-side 422s as field errors, not the generic error card', async () => {
    const user = userEvent.setup()
    installFetch({
      search: (params) => {
        if (params.get('keyword') === 'trigger') {
          return jsonResponse(
            { detail: [{ loc: ['query', 'keyword'], msg: 'keyword was rejected.', type: 'value_error' }] },
            422,
          )
        }
        return jsonResponse(makeResponse())
      },
    })
    renderApp()
    await screen.findByText('1 First St')

    await user.type(screen.getByLabelText('Keyword in description'), 'trigger')
    await user.click(screen.getByRole('button', { name: 'Search listings' }))

    // react-query retries once (~1s delay) before surfacing the error.
    expect(
      await screen.findByText('keyword was rejected.', {}, { timeout: 5000 }),
    ).toBeInTheDocument()
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument()
  })
})

describe('App — filters, chips, and pagination', () => {
  it('sends applied filters to the API and shows removable chips', async () => {
    const user = userEvent.setup()
    const { searchCalls } = installFetch()
    renderApp()
    await screen.findByText('1 First St')

    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Reston' } })
    await user.type(screen.getByLabelText('Keyword in description'), 'pool')
    await user.click(screen.getByRole('button', { name: 'Search listings' }))

    await waitFor(() => {
      const last = searchCalls[searchCalls.length - 1]
      expect(last.get('city')).toBe('Reston')
      expect(last.get('keyword')).toBe('pool')
      expect(last.get('page')).toBe('1') // page resets on new search
    })
    expect(await screen.findByRole('button', { name: 'Remove filter Reston' })).toBeInTheDocument()

    // Removing the city chip re-searches without it.
    await user.click(screen.getByRole('button', { name: 'Remove filter Reston' }))
    await waitFor(() => {
      const last = searchCalls[searchCalls.length - 1]
      expect(last.get('city')).toBeNull()
      expect(last.get('keyword')).toBe('pool')
    })
  })

  it('pages through results and updates the summary', async () => {
    const user = userEvent.setup()
    const items = Array.from({ length: 10 }, (_, i) =>
      makeItem({ property_id: `P${i}`, address: `${i} Test St` }),
    )
    const { searchCalls } = installFetch({
      search: (params) => {
        const page = Number(params.get('page') ?? '1')
        return jsonResponse(
          makeResponse({
            items: page === 2 ? [makeItem({ property_id: 'P10', address: '10 Test St' })] : items,
            page,
            pageSize: 10,
            total: 11,
            totalPages: 2,
            hasNext: page < 2,
            hasPrev: page > 1,
          }),
        )
      },
    })
    renderApp()
    await screen.findByText('0 Test St')
    // The summary spans multiple text nodes; match on the container instead.
    expect(document.querySelector('.pagination-summary')).toHaveTextContent(
      'Showing 1–10 of 11 results',
    )

    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(await screen.findByText('10 Test St')).toBeInTheDocument()
    expect(document.querySelector('.pagination-summary')).toHaveTextContent(
      'Showing 11–11 of 11 results',
    )
    expect(searchCalls[searchCalls.length - 1].get('page')).toBe('2')
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })

  it('jumps to a specific page via the numbered buttons', async () => {
    const user = userEvent.setup()
    const { searchCalls } = installFetch({
      search: (params) =>
        jsonResponse(
          makeResponse({
            page: Number(params.get('page') ?? '1'),
            pageSize: 10,
            total: 120,
            totalPages: 12,
            hasNext: true,
            hasPrev: true,
          }),
        ),
    })
    renderApp()
    await screen.findByText('1 First St')

    // The window only shows the current page ± 1, so page 2 is the reachable
    // jump from page 1 of a 12-page result set.
    await user.click(screen.getByRole('button', { name: 'Go to page 2' }))
    await waitFor(() => {
      expect(searchCalls[searchCalls.length - 1].get('page')).toBe('2')
    })
  })
})

describe('App — empty, out-of-range, and error states', () => {
  it('shows the empty state with a clear-filters escape hatch', async () => {
    const user = userEvent.setup()
    const { searchCalls } = installFetch({
      search: (params) => {
        if (params.get('minPrice')) {
          return jsonResponse(makeResponse({ items: [], total: 0, totalPages: 0 }))
        }
        return jsonResponse(makeResponse())
      },
    })
    renderApp()
    await screen.findByText('1 First St')

    await user.type(screen.getByLabelText('Min price'), '1000000')
    await user.click(screen.getByRole('button', { name: 'Search listings' }))

    expect(await screen.findByText('No listings match your search')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear all filters' }))
    await waitFor(() => {
      expect(searchCalls[searchCalls.length - 1].get('minPrice')).toBeNull()
    })
    expect(await screen.findByText('1 First St')).toBeInTheDocument()
  })

  it('explains when the database itself is empty', async () => {
    installFetch({
      search: () => jsonResponse(makeResponse({ items: [], total: 0, totalPages: 0 })),
    })
    renderApp()
    expect(await screen.findByText('No listings match your search')).toBeInTheDocument()
    expect(screen.getByText(/no listings in the database/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear all filters' })).not.toBeInTheDocument()
  })

  it('offers "Go to last page" when results shrink below the current page', async () => {
    const user = userEvent.setup()
    installFetch({
      search: (params, callIndex) => {
        const page = Number(params.get('page') ?? '1')
        if (callIndex === 1) {
          return jsonResponse(
            makeResponse({ page: 1, pageSize: 10, total: 50, totalPages: 5, hasNext: true }),
          )
        }
        if (callIndex === 2) {
          // Results shrank while the user was paging: only one page remains.
          return jsonResponse(makeResponse({ items: [], page, pageSize: 10, total: 4, totalPages: 1 }))
        }
        return jsonResponse(makeResponse())
      },
    })
    renderApp()
    await screen.findByText('1 First St')

    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText(/is past the last result/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Go to last page' }))
    expect(await screen.findByText('1 First St')).toBeInTheDocument()
  })

  it('shows an error card with retry that recovers on the next attempt', async () => {
    const user = userEvent.setup()
    installFetch({
      search: (_params, callIndex) => {
        // react-query retries once, so the first two attempts fail.
        if (callIndex <= 2) {
          return jsonResponse({ detail: 'The listing database is unavailable.' }, 503)
        }
        return jsonResponse(makeResponse())
      },
    })
    renderApp()

    // react-query retries once (~1s delay) before surfacing the error.
    expect(
      await screen.findByText('Something went wrong', {}, { timeout: 5000 }),
    ).toBeInTheDocument()
    expect(screen.getByText(/unavailable/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('1 First St')).toBeInTheDocument()
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument()
  })
})
