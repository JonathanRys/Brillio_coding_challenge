interface PaginationProps {
  page: number;
  totalPages: number;
  pageSize: number;
  total: number;
  countOnPage: number;
  disabled: boolean;
  onPageChange: (page: number) => void;
}

/**
 * Build the visible page buttons: first, last, current ± 1, with "…" gaps.
 * Returns numbers for pages and the string "…" for gaps.
 */
function pageWindow(page: number, totalPages: number): Array<number | "…"> {
  const pages = new Set<number>([1, totalPages, page - 1, page, page + 1]);
  const valid = [...pages]
    .filter((p) => p >= 1 && p <= totalPages)
    .sort((a, b) => a - b);

  const items: Array<number | "…"> = [];
  let previous = 0;
  for (const p of valid) {
    if (previous && p - previous > 1) items.push("…");
    items.push(p);
    previous = p;
  }
  return items;
}

const Pagination = ({
  page,
  totalPages,
  pageSize,
  total,
  countOnPage,
  disabled,
  onPageChange,
}: PaginationProps) => {
  if (total === 0) return null;

  const firstIndex = (page - 1) * pageSize + 1;
  const lastIndex = firstIndex + countOnPage - 1;
  const window = pageWindow(page, totalPages);

  return (
    <nav className="pagination" aria-label="Search results pages">
      <p className="pagination-summary">
        Showing{" "}
        <strong>
          {firstIndex}–{lastIndex}
        </strong>{" "}
        of <strong>{total}</strong> results
      </p>

      <div className="pagination-controls">
        <button
          type="button"
          className="button"
          onClick={() => onPageChange(page - 1)}
          disabled={disabled || page <= 1}
        >
          Previous
        </button>

        <ul className="pagination-pages">
          {window.map((entry, index) =>
            entry === "…" ? (
              <li
                key={`gap-${index}`}
                className="pagination-gap"
                aria-hidden="true"
              >
                …
              </li>
            ) : (
              <li key={entry}>
                <button
                  type="button"
                  className={`pagination-page${entry === page ? " pagination-page--current" : ""}`}
                  onClick={() => onPageChange(entry)}
                  disabled={disabled}
                  aria-current={entry === page ? "page" : undefined}
                  aria-label={`Go to page ${entry}`}
                >
                  {entry}
                </button>
              </li>
            ),
          )}
        </ul>

        <button
          type="button"
          className="button"
          onClick={() => onPageChange(page + 1)}
          disabled={disabled || page >= totalPages}
        >
          Next
        </button>
      </div>
    </nav>
  );
};

export default Pagination;
