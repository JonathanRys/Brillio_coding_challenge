import { useMemo, useState } from "react";
import "./App.css";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { SearchApiError, fetchCities, searchProperties } from "./api";
import type { SearchFilters } from "./api";
import SearchForm from "./components/SearchForm";
import Property from "./components/Property";
import Pagination from "./components/Pagination";
import {
  EMPTY_DRAFT,
  countActiveFilters,
  draftToFilters,
  serverErrorsToDraft,
  validateDraft,
} from "./validation";
import type { SearchDraft } from "./validation";

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

interface Chip {
  key: keyof SearchDraft;
  label: string;
}

/** Human-readable chips for the filters that are currently applied. */
function activeChips(filters: SearchFilters): Chip[] {
  const chips: Chip[] = [];
  if (filters.minPrice !== undefined) {
    chips.push({
      key: "minPrice",
      label: `Min ${currency.format(filters.minPrice)}`,
    });
  }
  if (filters.maxPrice !== undefined) {
    chips.push({
      key: "maxPrice",
      label: `Max ${currency.format(filters.maxPrice)}`,
    });
  }
  if (filters.minBedrooms !== undefined) {
    chips.push({ key: "minBedrooms", label: `${filters.minBedrooms}+ beds` });
  }
  if (filters.city) chips.push({ key: "city", label: filters.city });
  if (filters.keyword)
    chips.push({ key: "keyword", label: `“${filters.keyword}”` });
  if (filters.targetBudget !== undefined) {
    chips.push({
      key: "targetBudget",
      label: `Budget ${currency.format(filters.targetBudget)}`,
    });
  }
  return chips;
}

function App() {
  const [draft, setDraft] = useState<SearchDraft>(EMPTY_DRAFT);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Applied filters are only updated on submit; the page resets to 1 then.
  const [filters, setFilters] = useState<SearchFilters>(
    draftToFilters(EMPTY_DRAFT),
  );
  const [page, setPage] = useState(1);

  const { data, isPending, isError, error, isFetching, refetch } = useQuery({
    queryKey: ["property-search", filters, page],
    queryFn: ({ signal }) => searchProperties(filters, page, signal),
    placeholderData: keepPreviousData,
    retry: 1,
  });

  const citiesQuery = useQuery({
    queryKey: ["property-cities"],
    queryFn: fetchCities,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const chips = useMemo(() => activeChips(filters), [filters]);
  const activeCount = countActiveFilters(filters);

  const handleDraftChange = (field: keyof SearchDraft, value: string) => {
    setDraft((prev) => ({ ...prev, [field]: value }));
    // Clear the stale error for that field as soon as the user edits it.
    setErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const handleSubmit = () => {
    const clientErrors = validateDraft(draft);
    if (Object.keys(clientErrors).length > 0) {
      setErrors(clientErrors);
      return;
    }
    setErrors({});
    setFilters(draftToFilters(draft));
    setPage(1);
  };

  const handleReset = () => {
    setDraft(EMPTY_DRAFT);
    setErrors({});
    setFilters(draftToFilters(EMPTY_DRAFT));
    setPage(1);
  };

  /** Remove a single applied filter (chip ×) from both draft and results. */
  const handleRemoveChip = (key: keyof SearchDraft) => {
    const nextDraft = { ...draft, [key]: "" };
    setDraft(nextDraft);
    setFilters(draftToFilters(nextDraft));
    setPage(1);
  };

  // If the server rejected input (422) despite client-side checks, surface
  // its field errors so nothing fails silently.
  const serverFieldErrors =
    error instanceof SearchApiError && error.status === 422
      ? serverErrorsToDraft(error.fieldErrors)
      : {};

  const showServerError =
    isError && !(error instanceof SearchApiError && error.status === 422);
  const showSkeleton = isPending && !data;
  const showEmpty =
    !showSkeleton && !showServerError && data !== undefined && data.total === 0;
  const showResults =
    !showSkeleton && !showServerError && data !== undefined && data.total > 0;
  const showOutOfRangePage =
    showResults &&
    data.items.length === 0 &&
    data.totalPages > 0 &&
    page > data.totalPages;

  return (
    <main className="app">
      <header className="app-header">
        <h1>Find your next place</h1>
        <p className="app-subtitle">
          Filter property listings, rank them against your budget and how fresh
          they are, and page through the results.
        </p>
      </header>

      <section className="panel" aria-labelledby="filters-heading">
        <h2 id="filters-heading">Search filters</h2>
        <SearchForm
          draft={draft}
          errors={{ ...errors, ...serverFieldErrors }}
          cities={citiesQuery.data ?? []}
          citiesLoading={citiesQuery.isPending}
          onDraftChange={handleDraftChange}
          onSubmit={handleSubmit}
          onReset={handleReset}
          disabled={isFetching}
        />
      </section>

      <section
        className="results"
        aria-labelledby="results-heading"
        aria-busy={isFetching}
      >
        <div className="results-header">
          <h2 id="results-heading">
            Results
            {data && (
              <span className="results-count">
                {data.total.toLocaleString("en-US")} matching{" "}
                {data.total === 1 ? "listing" : "listings"}
              </span>
            )}
          </h2>
          {isFetching && data && (
            <span className="updating-pill">Updating…</span>
          )}
        </div>

        {chips.length > 0 && (
          <ul className="chip-list" aria-label="Applied filters">
            {chips.map((chip) => (
              <li key={chip.key}>
                <button
                  type="button"
                  className="chip"
                  onClick={() => handleRemoveChip(chip.key)}
                  aria-label={`Remove filter ${chip.label}`}
                >
                  {chip.label} <span aria-hidden="true">×</span>
                </button>
              </li>
            ))}
            <li>
              <button
                type="button"
                className="chip chip--clear"
                onClick={handleReset}
              >
                Clear all
              </button>
            </li>
          </ul>
        )}

        {data && (
          <p className="ranking-note">
            {data.ranking.mode === "budget+recency" ? (
              <>
                Ranked by <strong>relevance</strong> ={" "}
                {Math.round(data.ranking.budgetWeight * 100)}% budget fit +{" "}
                {Math.round(data.ranking.recencyWeight * 100)}% recency
                (freshness halves every {data.ranking.halfLifeDays} days).
                Over-budget prices are penalised more than under-budget ones.
              </>
            ) : (
              <>
                Ranked by <strong>recency</strong> only — set a target budget to
                also rank by how well each price matches it. Freshness halves
                every {data.ranking.halfLifeDays} days.
              </>
            )}
          </p>
        )}

        {showSkeleton && (
          <div
            className="skeleton-list"
            aria-label="Loading results"
            role="status"
          >
            {[0, 1, 2, 3].map((i) => (
              <div className="skeleton-card" key={i}>
                <div className="skeleton-line skeleton-line--title" />
                <div className="skeleton-line" />
                <div className="skeleton-line skeleton-line--short" />
              </div>
            ))}
          </div>
        )}

        {showServerError && (
          <div className="state-card state-card--error" role="alert">
            <h3>Something went wrong</h3>
            <p>
              {error instanceof Error
                ? error.message
                : "An unexpected error occurred."}
            </p>
            <button
              type="button"
              className="button button--primary"
              onClick={() => refetch()}
            >
              Try again
            </button>
          </div>
        )}

        {showEmpty && (
          <div className="state-card">
            <h3>No listings match your search</h3>
            <p>
              {activeCount > 0
                ? "Try widening your price range, lowering the bedroom count, or clearing some filters."
                : "There are no listings in the database yet."}
            </p>
            {activeCount > 0 && (
              <button
                type="button"
                className="button button--primary"
                onClick={handleReset}
              >
                Clear all filters
              </button>
            )}
          </div>
        )}

        {showOutOfRangePage && (
          <div className="state-card">
            <h3>Page {page} is past the last result</h3>
            <p>
              There{" "}
              {data.totalPages === 1
                ? "is only 1 page"
                : `are only ${data.totalPages} pages`}{" "}
              of results for this search.
            </p>
            <button
              type="button"
              className="button button--primary"
              onClick={() => setPage(Math.max(1, data.totalPages))}
            >
              Go to last page
            </button>
          </div>
        )}

        {showResults && (
          <>
            <div
              className={`properties${isFetching ? " properties--stale" : ""}`}
            >
              {data.items.map((listing, index) => (
                <Property
                  key={`property-${listing.property_id}`}
                  listing={listing}
                  rankOnPage={(page - 1) * data.pageSize + index + 1}
                />
              ))}
            </div>

            <Pagination
              page={data.page}
              totalPages={data.totalPages}
              pageSize={data.pageSize}
              total={data.total}
              countOnPage={data.items.length}
              disabled={isFetching}
              onPageChange={(next) => {
                setPage(next);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            />
          </>
        )}
      </section>

      <footer className="app-footer">
        <details>
          <summary>How the relevance score works</summary>
          <p>
            Every listing gets a score from 0–100. With a target budget set, the
            score is <code>0.7 × budgetFit + 0.3 × recency</code>:
          </p>
          <ul>
            <li>
              <strong>Budget fit</strong> — how close the price is to your
              target, as a fraction of the target. At or under budget decays
              gently (×0.5); over budget decays steeply (×1.5), because
              overshooting feels worse than coming in under. A listing exactly
              at budget scores 1.0; one 20% over scores 0.7.
            </li>
            <li>
              <strong>Recency</strong> — exponential decay with a 30-day
              half-life: a listing from today scores 1.0, one from 30 days ago
              scores 0.5, and so on. Listings with a missing date get a neutral
              0.5 so bad data can't dominate or be buried.
            </li>
          </ul>
          <p>
            Without a budget there's nothing meaningful to compare price
            against, so ranking falls back to recency alone. Ties break by
            newest listed date, then lowest price. Hard filters (price range,
            bedrooms, city, description keyword) are applied in MongoDB before
            scoring; on very large datasets you'd push the scoring into an
            aggregation pipeline or search index instead.
          </p>
        </details>
      </footer>
    </main>
  );
}

export default App;
