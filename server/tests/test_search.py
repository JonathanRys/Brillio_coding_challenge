"""Unit tests for search.py — the pure relevance-scoring module."""

from datetime import datetime, timedelta, timezone

from search import (
    budget_fit,
    parse_listed_date,
    rank_listings,
    recency_fit,
    score_listing,
)

# Midnight so date-only ISO strings map to exact day boundaries in recency math.
NOW = datetime(2026, 10, 16)


class TestParseListedDate:
    def test_iso_string(self):
        assert parse_listed_date("2026-08-29") == datetime(2026, 8, 29)

    def test_iso_string_with_z_suffix(self):
        assert parse_listed_date("2026-08-29T10:30:00Z") == datetime(2026, 8, 29, 10, 30)

    def test_naive_datetime_passthrough(self):
        dt = datetime(2026, 1, 1)
        assert parse_listed_date(dt) == dt

    def test_aware_datetime_converted_to_naive_utc(self):
        aware = datetime(2026, 1, 1, 12, 0, tzinfo=timezone(timedelta(hours=-5)))
        assert parse_listed_date(aware) == datetime(2026, 1, 1, 17, 0)

    def test_invalid_string_returns_none(self):
        assert parse_listed_date("not-a-date") is None

    def test_none_returns_none(self):
        assert parse_listed_date(None) is None

    def test_unexpected_type_returns_none(self):
        assert parse_listed_date(12345) is None


class TestBudgetFit:
    def test_exact_match_is_perfect(self):
        assert budget_fit(500_000, 500_000) == 1.0

    def test_ten_percent_under_budget(self):
        assert abs(budget_fit(450_000, 500_000) - 0.95) < 1e-9

    def test_twenty_percent_under_budget(self):
        assert abs(budget_fit(400_000, 500_000) - 0.9) < 1e-9

    def test_ten_percent_over_budget_penalised_more_than_under(self):
        under = budget_fit(450_000, 500_000)
        over = budget_fit(550_000, 500_000)
        assert abs(over - 0.85) < 1e-9
        assert over < under  # same deviation, harsher slope

    def test_twenty_percent_over_budget(self):
        assert abs(budget_fit(600_000, 500_000) - 0.7) < 1e-9

    def test_over_budget_clamped_at_zero(self):
        assert budget_fit(900_000, 500_000) == 0.0
        assert budget_fit(5_000_000, 500_000) == 0.0

    def test_free_listing_under_target_is_half_fit(self):
        # deviation of 100% under: 1 - 0.5 * 1.0
        assert abs(budget_fit(0, 500_000) - 0.5) < 1e-9

    def test_non_positive_target_returns_perfect_fit(self):
        # Defensive: ranking never passes this, but it must not divide by zero.
        assert budget_fit(500_000, 0) == 1.0


class TestRecencyFit:
    def test_today_is_perfect(self):
        assert recency_fit(NOW.date().isoformat(), now=NOW) == 1.0

    def test_half_life(self):
        thirty_days_ago = (NOW - timedelta(days=30)).isoformat()
        assert abs(recency_fit(thirty_days_ago, now=NOW) - 0.5) < 1e-9

    def test_two_half_lives(self):
        sixty_days_ago = (NOW - timedelta(days=60)).isoformat()
        assert abs(recency_fit(sixty_days_ago, now=NOW) - 0.25) < 1e-9

    def test_future_date_clamped_to_perfect(self):
        tomorrow = (NOW + timedelta(days=1)).isoformat()
        assert recency_fit(tomorrow, now=NOW) == 1.0

    def test_missing_date_gets_neutral_score(self):
        assert recency_fit(None, now=NOW) == 0.5

    def test_unparseable_date_gets_neutral_score(self):
        assert recency_fit("whenever", now=NOW) == 0.5


class TestScoreListing:
    def test_at_budget_and_fresh_is_100(self):
        result = score_listing({"price": 500_000, "listedDate": "2026-10-16"}, 500_000, now=NOW)
        assert result["score"] == 100.0
        assert result["budgetFit"] == 1.0
        assert result["recency"] == 1.0
        assert result["ageDays"] == 0

    def test_at_budget_but_one_half_life_old_is_85(self):
        # 0.7 * 1.0 + 0.3 * 0.5 = 0.85
        result = score_listing({"price": 500_000, "listedDate": "2026-09-16"}, 500_000, now=NOW)
        assert abs(result["score"] - 85.0) < 0.1

    def test_no_budget_ranks_on_recency_only(self):
        result = score_listing({"price": 500_000, "listedDate": "2026-10-16"}, None, now=NOW)
        assert result["score"] == 100.0
        assert result["budgetFit"] is None

    def test_no_budget_half_life_old_is_50(self):
        result = score_listing({"price": 500_000, "listedDate": "2026-09-16"}, None, now=NOW)
        assert abs(result["score"] - 50.0) < 0.1

    def test_missing_date_with_budget_is_neutral_on_recency(self):
        # 0.7 * fit(1.0) + 0.3 * 0.5 = 0.85
        result = score_listing({"price": 500_000, "listedDate": None}, 500_000, now=NOW)
        assert abs(result["score"] - 85.0) < 0.1
        assert result["ageDays"] is None

    def test_budget_fit_still_dominates_older_listing(self):
        # An at-budget listing from 45 days ago beats a fresh over-budget one.
        at_budget_older = score_listing(
            {"price": 500_000, "listedDate": (NOW - timedelta(days=45)).isoformat()},
            500_000,
            now=NOW,
        )
        fresh_over = score_listing(
            {"price": 650_000, "listedDate": "2026-10-16"}, 500_000, now=NOW
        )
        assert at_budget_older["score"] > fresh_over["score"]


class TestRankListings:
    def _docs(self):
        return [
            {"price": 700_000, "listedDate": "2026-10-16", "property_id": "over"},
            {"price": 500_000, "listedDate": "2026-09-16", "property_id": "at_old"},
            {"price": 500_000, "listedDate": "2026-10-16", "property_id": "at_new"},
            {"price": 490_000, "listedDate": "2026-10-16", "property_id": "near_new"},
        ]

    def test_sorted_by_score_descending(self):
        ranked = rank_listings(self._docs(), target_budget=500_000, now=NOW)
        scores = [r["score"] for r in ranked]
        assert scores == sorted(scores, reverse=True)

    def test_expected_ordering_around_budget(self):
        ranked = rank_listings(self._docs(), target_budget=500_000, now=NOW)
        order = [r["property_id"] for r in ranked]
        # at-budget today, just-under-budget today, at-budget 45d ago, over budget
        assert order == ["at_new", "near_new", "at_old", "over"]

    def test_recency_only_mode_without_budget(self):
        ranked = rank_listings(self._docs(), target_budget=None, now=NOW)
        scores = [r["score"] for r in ranked]
        assert scores == sorted(scores, reverse=True)
        assert all(r["budgetFit"] is None for r in ranked)

    def test_tie_break_prefers_newer_date(self):
        docs = [
            {"price": 500_000, "listedDate": "2026-10-01", "property_id": "older"},
            {"price": 500_000, "listedDate": "2026-10-02", "property_id": "newer"},
        ]
        ranked = rank_listings(docs, target_budget=500_000, now=NOW)
        assert [r["property_id"] for r in ranked] == ["newer", "older"]

    def test_tie_break_prefers_lower_price_when_dates_match(self):
        docs = [
            {"price": 510_000, "listedDate": "2026-10-01", "property_id": "pricier"},
            {"price": 490_000, "listedDate": "2026-10-01", "property_id": "cheaper"},
        ]
        ranked = rank_listings(docs, target_budget=500_000, now=NOW)
        assert [r["property_id"] for r in ranked] == ["cheaper", "pricier"]

    def test_missing_date_sorts_last_within_tie(self):
        docs = [
            {"price": 500_000, "listedDate": None, "property_id": "no_date"},
            {"price": 500_000, "listedDate": "2026-10-01", "property_id": "dated"},
        ]
        ranked = rank_listings(docs, target_budget=500_000, now=NOW)
        assert [r["property_id"] for r in ranked] == ["dated", "no_date"]

    def test_empty_input(self):
        assert rank_listings([], target_budget=500_000, now=NOW) == []

    def test_original_documents_not_mutated(self):
        docs = self._docs()
        rank_listings(docs, target_budget=500_000, now=NOW)
        assert all("score" not in d for d in docs)
