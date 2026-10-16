import Address from "./Address";
import type { SearchItem } from "../api";

interface PropertyProps {
  listing: SearchItem;
  /** Index within the current page (1-based), shown as the rank. */
  rankOnPage: number;
}

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** Map a 0-100 score to a coarse quality band for colouring. */
function scoreBand(score: number): "high" | "medium" | "low" {
  if (score >= 60) return "high";
  if (score >= 30) return "medium";
  return "low";
}

function ageLabel(ageDays: number | null): string {
  if (ageDays === null) return "date unknown";
  if (ageDays < 1) return "listed today";
  if (ageDays === 1) return "listed 1 day ago";
  return `listed ${ageDays} days ago`;
}

const Property = ({ listing, rankOnPage }: PropertyProps) => {
  const {
    property_id,
    source,
    address,
    city,
    state,
    zip,
    price,
    bedrooms,
    bathrooms,
    sqft,
    listedDate,
    status,
    description,
    score,
    scoreBreakdown,
  } = listing;

  const band = scoreBand(score);
  const budgetPart =
    scoreBreakdown.budgetFit !== null
      ? `Budget fit ${(scoreBreakdown.budgetFit * 100).toFixed(0)}%`
      : null;
  const recencyPart = `Recency ${(scoreBreakdown.recency * 100).toFixed(0)}%`;
  const breakdownTitle = [
    budgetPart,
    recencyPart,
    ageLabel(scoreBreakdown.ageDays),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <article className="property" aria-label={`Listing ${property_id}`}>
      <div className="property-rank" aria-hidden="true">
        #{rankOnPage}
      </div>

      <div className="property-main">
        <div className="property-heading">
          <Address address={address} city={city} state={state} zip={zip} />
          <div className="property-price">{currency.format(price)}</div>
        </div>

        <ul className="property-facts">
          <li>
            <strong>{bedrooms}</strong> bd
          </li>
          <li>
            <strong>{bathrooms}</strong> ba
          </li>
          {sqft !== null && (
            <li>
              <strong>{sqft.toLocaleString("en-US")}</strong> sqft
            </li>
          )}
          <li className={`property-status property-status--${status}`}>
            {status}
          </li>
          <li className="property-meta">
            {listedDate ? `Listed ${listedDate}` : "Listed date unknown"} ·{" "}
            {source}
          </li>
        </ul>

        {description && <p className="property-description">{description}</p>}
      </div>

      <div className="property-score" title={breakdownTitle}>
        <span className={`score-badge score-badge--${band}`}>
          <span className="score-value">{score.toFixed(1)}</span>
          <span className="score-label">relevance</span>
        </span>
        <span className="score-bar" aria-hidden="true">
          <span
            className={`score-bar-fill score-bar-fill--${band}`}
            style={{ width: `${Math.max(0, Math.min(100, score))}%` }}
          />
        </span>
        <span className="score-breakdown">{breakdownTitle}</span>
      </div>
    </article>
  );
};

export default Property;
