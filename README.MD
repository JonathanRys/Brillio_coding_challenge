# Listing Search — Technical Challenge

A full-stack property listing search UI with real filtering, relevance ranking, and pagination.

- **Backend:** FastAPI + MongoDB (Motor async driver) — `server/`
- **Frontend:** React 19 + TypeScript + Vite + TanStack Query — `app/`
- **Data:** `data/sample_listings.json` — 12 handcrafted Northern Virginia listings

## Quick start

```bash
# 1. MongoDB (e.g. via Docker)
docker run -d --name mongo -p 27017:27017 mongo:7

# 2. Backend (from server/)
python -m venv .venv && .venv/bin/pip install -r requirements.txt
cd server
../.venv/bin/python seed.py                        # seed the database
../.venv/bin/fastapi dev main.py                   # API on http://localhost:8000

# 3. Frontend (from app/)
cd app
npm install
npm run dev                                        # UI on http://localhost:5173 (or 5174)
```

The Vite dev server proxies `/api/*` to the FastAPI backend, so no CORS
configuration is needed during development.

## Features

- **Filtering** — `minPrice`, `maxPrice`, `minBedrooms`, `city` (exact,
  case-insensitive), and a free-text `keyword` matched case-insensitively
  against the description (regex-escaped, so input like `c++` is safe).
- **Relevance ranking** — a `targetBudget` plus listing recency produce a
  0–100 score per listing (design below). Without a target budget, ranking
  falls back to recency alone.
- **Pagination** — numbered pages (first/last/current ± 1 with `…` gaps),
  Previous/Next, and a "Showing X–Y of Z results" summary.
- **States** — loading skeletons, a dimmed "Updating…" transition when
  paging (previous data stays visible), a no-results state with a
  clear-filters action, an out-of-range page state, and an error state with
  a retry button.

## API

### `GET /properties/search`

| Param          | Type   | Bounds / rules                                    | Effect |
| -------------- | ------ | ------------------------------------------------- | ------ |
| `minPrice`     | float  | ≥ 0; must be ≤ `maxPrice`                         | Hard filter |
| `maxPrice`     | float  | ≥ 0                                               | Hard filter |
| `minBedrooms`  | int    | 0–20                                              | Hard filter |
| `city`         | string | ≤ 100 chars; trimmed; exact but case-insensitive  | Hard filter |
| `keyword`      | string | ≤ 100 chars; trimmed                              | Hard filter on `description` |
| `targetBudget` | float  | > 0                                               | Ranking input |
| `page`         | int    | ≥ 1 (default 1)                                   | Pagination |
| `pageSize`     | int    | 1–50 (default 10)                                 | Pagination |

Response shape:

```json
{
  "items": [
    {
      "property_id": "G36", "address": "2168 Rolling Mill Ave", "city": "Manassas",
      "price": 469000.0, "bedrooms": 3, "score": 95.9,
      "scoreBreakdown": { "budgetFit": 0.969, "recency": 0.936, "ageDays": 3 }
    }
  ],
  "page": 1, "pageSize": 10, "total": 12, "totalPages": 2,
  "hasNext": true, "hasPrev": false,
  "ranking": { "mode": "budget+recency", "budgetWeight": 0.7,
               "recencyWeight": 0.3, "halfLifeDays": 30 }
}
```

The `ranking` block is echoed so the UI can explain exactly how the current
results were scored.

### `GET /properties/cities`

Sorted distinct city names, used to populate the city dropdown.

Pre-existing endpoints (`POST /ingest`, `GET /properties/`,
`POST /properties/`, `GET /property/{id}`) are unchanged.

## Testing

Both suites run without any external services — the backend uses an in-memory
fake Mongo collection, the frontend mocks `fetch`.

```bash
# Backend — pytest (79 tests)
cd server
../.venv/bin/python -m pytest tests/ -q

# Frontend — Vitest (69 tests)
cd app
npm test              # single run
npm run test:watch    # watch mode
npm run test:coverage # with v8 coverage
```

### What's covered

**Backend** (`server/tests/`)

- `test_search.py` — the pure scoring module: date parsing (strings,
  datetimes, garbage), budget-fit slopes and clamping, recency half-life,
  weighted score composition, recency-only mode, deterministic tie-breaking,
  and input immutability.
- `test_main.py` — endpoint behaviour via FastAPI's `TestClient` with a fake
  collection: every deliberate 422 (min > max, negatives, bad pageSize/page,
  non-numeric input, overlong/blank text), exact Mongo filter construction
  (anchored/escaped regexes), ranking modes and score metadata, pagination
  math (flags, out-of-range pages, zero results), 503s on DB failure, the
  cities endpoint, and smoke tests for the pre-existing endpoints.

**Frontend** (`app/src/**/*.test.{ts,tsx}`)

- `validation.test.ts` — all client-side rules and helpers.
- `api.test.ts` — query-string construction, 422 detail parsing, network and
  HTTP error wrapping, abort-signal forwarding.
- `Pagination.test.tsx` — windowed page buttons, ellipses, disabled states,
  range summary, click handling.
- `Property.test.tsx` — card rendering, score banding, breakdown display,
  missing-data handling.
- `SearchForm.test.tsx` — inputs, city options, change/submit/reset events,
  inline error rendering and aria wiring.
- `App.test.tsx` — integration: skeleton → results, ranking-mode explainer,
  validation blocking requests, server-422 field mapping, filter chips,
  paging end-to-end, empty state, out-of-range page recovery, and the error
  card with retry.

## Relevance scoring design

Every listing gets a score from 0–100. **With a target budget:**

```
score = 100 × (0.7 × budgetFit + 0.3 × recency)
```

**Without one**, there's nothing meaningful to compare price against, so the
score is `100 × recency` and the response flags `mode: "recency-only"`.

### budgetFit (0–1)

A piecewise-linear decay on the *relative* deviation of the price from the
target (`|price − target| / target`):

- **At or under budget:** `fit = 1 − 0.5 × deviation` — being under budget is
  good, but a listing far below the target is a weaker match for what the
  searcher asked for (they want the *best* home their budget allows, not the
  cheapest).
- **Over budget:** `fit = 1 − 1.5 × deviation` — overshooting is penalised
  three times as hard as coming in under, which matches how buyers actually
  feel about budget ceilings.
- Clamped to [0, 1]. Example: at target = 1.0 fit; 20% under = 0.9;
  20% over = 0.7; ≥67% over = 0.

Why linear rather than a Gaussian/exponential? It's transparent and easy to
explain in the UI ("over-budget decays 3× faster"), and with a single
candidate set it behaves identically in spirit to smoother curves.

### recency (0–1)

Exponential half-life decay on the listing's age:

```
recency = 0.5 ^ (ageDays / 30)
```

A listing from today scores 1.0, one from 30 days ago 0.5, 90 days ago
0.125. Fresh listings should generally win, but budget fit dominates the
weighted sum, so a 45-day-old listing exactly at budget still outranks a
day-old listing that's 30% over. Listings with a missing/unparseable date
get a neutral 0.5 so bad data can neither dominate nor be buried.

### Ties and ordering

Sort is deterministic: score desc, then newest `listedDate`, then lowest
price — so identical searches always return identical pages.

### Where scoring runs

Hard filters are pushed into MongoDB; scoring happens in Python over the
filtered candidate set (`server/search.py`, a pure, unit-testable module).
That's sensible for this corpus (12 docs). At real scale you'd port the
same formula into an aggregation pipeline (`$expr` + `$exp`) or a search
index so only one page of scored results is materialised per request.

## Input validation (deliberate, both sides)

The server revalidates everything; the client mirrors the same rules so most
mistakes are caught inline before a request is made:

- `minPrice > maxPrice` → 422 "minPrice (600000) cannot be greater than
  maxPrice (400000)." (also surfaced as an inline form error).
- Negative prices / non-positive `targetBudget` → 422.
- `pageSize` outside 1–50 or `page < 1` → 422 (FastAPI bound checks).
- `minBedrooms` outside 0–20 or non-integer (client) → error.
- Blank `city`/`keyword` are trimmed and treated as "not provided".
- `keyword`/`city` longer than 100 chars → 422.
- All 422s share one shape — `{"detail": [{"loc": ["query", field], "msg": …}]}` —
  which the client maps back onto the offending form field.
- A `page` beyond the last page returns an empty page (not an error) with
  correct `totalPages`, and the UI offers "Go to last page".

## Frontend behavior

- Inputs are draft state; results only change when **Search** is clicked
  (resetting to page 1). Paging never re-validates the form.
- TanStack Query keys on `(filters, page)` with `keepPreviousData`, so page
  changes dim the list and show "Updating…" instead of flashing a skeleton.
- Server 422s that slip past client validation are rendered as field errors,
  never swallowed; other failures get a retry card.
- The score badge is colour-banded (≥60 high, ≥30 medium, below low) with a
  fill bar and a budget-fit / recency / age breakdown on every card.

## Assumptions & limitations

- City matching is exact (case-insensitive), not fuzzy — the dropdown avoids
  most typos; keyword is a substring match, not tokenized/weighted search.
- `listedDate` values are naive ISO dates; recency uses server UTC "now".
  The sample data spans mid-2026, so absolute recency shifts with the real
  clock — the ranking *relative order* is stable.
- Scoring loads all filtered candidates into memory (fine at 12 docs; see
  "Where scoring runs" for the scale-out path).
- The sample dataset is synthetic; duplicates across "sources" are
  intentional to mirror multi-MLS data, but no dedup logic is implemented.
