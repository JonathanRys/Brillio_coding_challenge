"""Search filtering and relevance scoring for property listings.

Relevance score design (0-100, higher is better):
    When a ``targetBudget`` is provided:
        score = 100 * (0.7 * budgetFit + 0.3 * recency)
    When no ``targetBudget`` is provided there is nothing meaningful to
    measure budget fit against, so results are ranked on recency alone:
        score = 100 * recency

    budgetFit (0-1):
        Measures how close a listing's price is to the target budget using a
        piecewise-linear decay on the *relative* deviation from the target:
            - At or under budget:  fit = 1 - 0.5 * |price - target| / target
              (being under budget is good, but wildly-cheaper listings are
              treated as a weaker match for what the searcher asked for)
            - Over budget:         fit = 1 - 1.5 * |price - target| / target
              (overshooting the budget is penalised much more harshly than
              coming in under it, which matches how buyers actually feel)
        The result is clamped to [0, 1].

    recency (0-1):
        Exponential half-life decay on the listing's age:
            recency = 0.5 ** (age_days / HALF_LIFE_DAYS)
        With HALF_LIFE_DAYS = 30, a listing from today scores 1.0, one from
        30 days ago scores 0.5, and one from 90 days ago scores 0.125.
        Fresh listings should outrank stale ones when everything else is
        equal, but an older listing can still win on budget fit.

Ties are broken deterministically: newer listedDate first, then lower price.

Scoring happens in Python after the hard filters are applied in MongoDB.
That is a deliberate trade-off: the filter narrows the candidate set, then a
single, testable scoring function ranks it. For a very large corpus you would
push this into an aggregation pipeline or a search index, but the formula is
pure arithmetic and trivially portable there.
"""

from datetime import datetime, timezone
from typing import Any, Dict, Optional

# Weight of budget fit vs. recency when a target budget is supplied.
BUDGET_WEIGHT = 0.7
RECENCY_WEIGHT = 0.3

# Number of days after which a listing's recency score halves.
HALF_LIFE_DAYS = 30

# Slope of the budget-fit decay, by direction relative to the target.
UNDER_BUDGET_PENALTY = 0.5
OVER_BUDGET_PENALTY = 1.5


def parse_listed_date(value: Any) -> Optional[datetime]:
    """Parse a listing date that may be a str, datetime, or something else.

    Seeded documents store ``listedDate`` as an ISO string ("2026-08-29")
    while documents written through the pydantic /ingest path arrive as
    datetime objects. The search must handle both deliberately.
    """
    if isinstance(value, datetime):
        return value if value.tzinfo is None else value.astimezone(timezone.utc).replace(tzinfo=None)
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
        except ValueError:
            return None
    return None


def budget_fit(price: float, target_budget: float) -> float:
    """Return a 0-1 fit of ``price`` against ``target_budget``.

    Uses a piecewise-linear decay on the relative deviation from the target:
    gentle when at/under budget, steep when over budget (see module docstring).
    """
    if target_budget <= 0:
        return 1.0
    relative_deviation = abs(price - target_budget) / target_budget
    if price <= target_budget:
        fit = 1.0 - UNDER_BUDGET_PENALTY * relative_deviation
    else:
        fit = 1.0 - OVER_BUDGET_PENALTY * relative_deviation
    return max(0.0, min(1.0, fit))


def recency_fit(listed_date: Any, now: Optional[datetime] = None) -> float:
    """Return a 0-1 recency score with a 30-day half-life.

    Listings with unparseable dates get a neutral 0.5 so a bad record can
    neither dominate the top of the results nor be unfairly buried.
    """
    if now is None:
        now = datetime.now(timezone.utc).replace(tzinfo=None)
    listed = parse_listed_date(listed_date)
    if listed is None:
        return 0.5
    age_days = max(0.0, (now - listed).total_seconds() / 86400.0)
    return 0.5 ** (age_days / HALF_LIFE_DAYS)


def score_listing(
    listing: Dict[str, Any],
    target_budget: Optional[float] = None,
    now: Optional[datetime] = None,
) -> Dict[str, Any]:
    """Score a single listing and return the breakdown alongside the total.

    Returns a dict with ``score`` (0-100, rounded to 1dp), ``budgetFit``
    (None when no target budget was supplied), ``recency`` (0-1) and
    ``ageDays`` for display in the UI.
    """
    raw_date = listing.get("listedDate") or listing.get("listed_date")
    recency = recency_fit(raw_date, now=now)
    listed = parse_listed_date(raw_date)
    now_ref = now or datetime.now(timezone.utc).replace(tzinfo=None)
    age_days = max(0.0, (now_ref - listed).total_seconds() / 86400.0) if listed else None

    if target_budget is not None:
        fit = budget_fit(float(listing["price"]), target_budget)
        total = 100.0 * (BUDGET_WEIGHT * fit + RECENCY_WEIGHT * recency)
    else:
        fit = None
        total = 100.0 * recency

    return {
        "score": round(total, 1),
        "budgetFit": round(fit, 3) if fit is not None else None,
        "recency": round(recency, 3),
        "ageDays": round(age_days) if age_days is not None else None,
    }


def rank_listings(
    listings: list,
    target_budget: Optional[float] = None,
    now: Optional[datetime] = None,
) -> list:
    """Score and sort listings by relevance (desc), with deterministic ties."""
    scored = []
    for listing in listings:
        breakdown = score_listing(listing, target_budget=target_budget, now=now)
        scored.append({**listing, **breakdown})

    def sort_key(item: Dict[str, Any]) -> tuple:
        listed = parse_listed_date(item.get("listedDate") or item.get("listed_date"))
        # Sort ascending, so negate the score and timestamp; listings with a
        # missing date fall back to the epoch so they sort last on recency.
        ts = listed.timestamp() if listed else float("-inf")
        return (-item["score"], -ts, item["price"])

    scored.sort(key=sort_key)
    return scored
