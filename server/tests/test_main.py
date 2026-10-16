"""Endpoint tests for main.py using a fake Mongo collection (no real DB)."""

import main


def _assert_422_field(client, params, field, msg_part=None):
    response = client.get("/properties/search", params=params)
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert isinstance(detail, list) and detail, detail
    assert detail[0]["loc"] == ["query", field], detail
    if msg_part:
        assert msg_part in detail[0]["msg"], detail[0]["msg"]
    return response


class TestSearchValidation:
    """Every invalid input should produce a deliberate 422 with a field loc."""

    def test_min_price_greater_than_max_price(self, client):
        _assert_422_field(
            client,
            {"minPrice": 600000, "maxPrice": 400000},
            "minPrice",
            "cannot be greater than maxPrice",
        )

    def test_negative_min_price(self, client):
        _assert_422_field(client, {"minPrice": -5}, "minPrice", "zero or greater")

    def test_negative_max_price(self, client):
        _assert_422_field(client, {"maxPrice": -1}, "maxPrice", "zero or greater")

    def test_zero_target_budget(self, client):
        _assert_422_field(client, {"targetBudget": 0}, "targetBudget", "greater than zero")

    def test_negative_target_budget(self, client):
        _assert_422_field(client, {"targetBudget": -100}, "targetBudget", "greater than zero")

    def test_page_below_one(self, client):
        _assert_422_field(client, {"page": 0}, "page")

    def test_page_size_zero(self, client):
        _assert_422_field(client, {"pageSize": 0}, "pageSize")

    def test_page_size_above_max(self, client):
        response = _assert_422_field(client, {"pageSize": 51}, "pageSize")
        assert "50" in response.json()["detail"][0]["msg"]

    def test_non_numeric_price(self, client):
        _assert_422_field(client, {"minPrice": "abc"}, "minPrice")

    def test_non_integer_bedrooms(self, client):
        _assert_422_field(client, {"minBedrooms": 2.5}, "minBedrooms")

    def test_bedrooms_above_max(self, client):
        _assert_422_field(client, {"minBedrooms": 21}, "minBedrooms")

    def test_overlong_keyword(self, client):
        _assert_422_field(client, {"keyword": "x" * 101}, "keyword", "100 characters or fewer")

    def test_overlong_city(self, client):
        _assert_422_field(client, {"city": "x" * 101}, "city", "100 characters or fewer")

    def test_blank_keyword_treated_as_absent(self, client, fake_collection):
        response = client.get("/properties/search", params={"keyword": "   "})
        assert response.status_code == 200
        assert "description" not in fake_collection.last_filter

    def test_blank_city_treated_as_absent(self, client, fake_collection):
        response = client.get("/properties/search", params={"city": "  "})
        assert response.status_code == 200
        assert "city" not in fake_collection.last_filter


class TestFilterConstruction:
    """The endpoint should translate params into a precise Mongo filter."""

    def test_no_params_produces_empty_filter(self, client, fake_collection):
        response = client.get("/properties/search")
        assert response.status_code == 200
        assert fake_collection.last_filter == {}

    def test_price_range(self, client, fake_collection):
        client.get("/properties/search", params={"minPrice": 300000, "maxPrice": 600000})
        assert fake_collection.last_filter["price"] == {"$gte": 300000.0, "$lte": 600000.0}

    def test_min_price_only(self, client, fake_collection):
        client.get("/properties/search", params={"minPrice": 300000})
        assert fake_collection.last_filter["price"] == {"$gte": 300000.0}

    def test_max_price_only(self, client, fake_collection):
        client.get("/properties/search", params={"maxPrice": 600000})
        assert fake_collection.last_filter["price"] == {"$lte": 600000.0}

    def test_min_bedrooms(self, client, fake_collection):
        client.get("/properties/search", params={"minBedrooms": 3})
        assert fake_collection.last_filter["bedrooms"] == {"$gte": 3}

    def test_city_is_anchored_and_case_insensitive(self, client, fake_collection):
        client.get("/properties/search", params={"city": "springfield"})
        assert fake_collection.last_filter["city"] == {
            "$regex": r"^springfield$",
            "$options": "i",
        }

    def test_city_is_regex_escaped(self, client, fake_collection):
        client.get("/properties/search", params={"city": "a.b"})
        assert fake_collection.last_filter["city"]["$regex"] == r"^a\.b$"

    def test_keyword_is_case_insensitive_substring(self, client, fake_collection):
        client.get("/properties/search", params={"keyword": "Pool"})
        assert fake_collection.last_filter["description"] == {
            "$regex": "Pool",
            "$options": "i",
        }

    def test_keyword_is_regex_escaped(self, client, fake_collection):
        client.get("/properties/search", params={"keyword": "c++"})
        assert fake_collection.last_filter["description"]["$regex"] == r"c\+\+"

    def test_all_filters_combined(self, client, fake_collection):
        client.get(
            "/properties/search",
            params={
                "minPrice": 100,
                "maxPrice": 200,
                "minBedrooms": 2,
                "city": "Fairfax",
                "keyword": "garage",
            },
        )
        assert fake_collection.last_filter == {
            "price": {"$gte": 100.0, "$lte": 200.0},
            "bedrooms": {"$gte": 2},
            "city": {"$regex": r"^Fairfax$", "$options": "i"},
            "description": {"$regex": "garage", "$options": "i"},
        }


class TestRankingAndResponseShape:
    def test_budget_mode_metadata(self, client):
        body = client.get("/properties/search", params={"targetBudget": 500000}).json()
        assert body["ranking"] == {
            "mode": "budget+recency",
            "budgetWeight": 0.7,
            "recencyWeight": 0.3,
            "halfLifeDays": 30,
        }

    def test_recency_only_mode_metadata_without_budget(self, client):
        body = client.get("/properties/search").json()
        assert body["ranking"]["mode"] == "recency-only"
        assert body["ranking"]["budgetWeight"] == 0.0
        assert body["ranking"]["recencyWeight"] == 1.0

    def test_items_carry_score_and_breakdown(self, client):
        body = client.get("/properties/search", params={"targetBudget": 500000}).json()
        for item in body["items"]:
            assert 0 <= item["score"] <= 100
            assert 0 <= item["scoreBreakdown"]["recency"] <= 1
            assert item["scoreBreakdown"]["budgetFit"] is not None
            assert "ageDays" in item["scoreBreakdown"]

    def test_scores_sorted_descending(self, client):
        body = client.get(
            "/properties/search", params={"targetBudget": 500000, "pageSize": 50}
        ).json()
        scores = [item["score"] for item in body["items"]]
        assert scores == sorted(scores, reverse=True)

    def test_at_budget_fresh_listing_ranks_first(self, client):
        # T1 is priced exactly at the target and listed today.
        body = client.get("/properties/search", params={"targetBudget": 500000}).json()
        assert body["items"][0]["property_id"] == "T1"

    def test_internal_id_not_leaked(self, client):
        body = client.get("/properties/search").json()
        for item in body["items"]:
            assert "_id" not in item


class TestPagination:
    def test_totals_and_flags_first_page(self, client):
        body = client.get("/properties/search", params={"pageSize": 2}).json()
        assert body["total"] == 5
        assert body["totalPages"] == 3
        assert body["page"] == 1
        assert len(body["items"]) == 2
        assert body["hasPrev"] is False
        assert body["hasNext"] is True

    def test_middle_page(self, client):
        body = client.get("/properties/search", params={"pageSize": 2, "page": 2}).json()
        assert len(body["items"]) == 2
        assert body["hasPrev"] is True
        assert body["hasNext"] is True

    def test_last_partial_page(self, client):
        body = client.get("/properties/search", params={"pageSize": 2, "page": 3}).json()
        assert len(body["items"]) == 1
        assert body["hasPrev"] is True
        assert body["hasNext"] is False

    def test_page_beyond_end_returns_empty_not_error(self, client):
        body = client.get("/properties/search", params={"pageSize": 2, "page": 99}).json()
        assert body["items"] == []
        assert body["total"] == 5
        assert body["totalPages"] == 3
        assert body["hasNext"] is False

    def test_no_results_at_all(self, monkeypatch):
        # The fake collection returns its canned docs regardless of filter, so
        # an "empty database" fixture is the honest way to test the zero-state.
        from fastapi.testclient import TestClient
        from tests.conftest import FakeCollection

        monkeypatch.setattr(main, "collection", FakeCollection([]))
        body = TestClient(main.app).get(
            "/properties/search", params={"minPrice": 10_000_000}
        ).json()
        assert body["items"] == []
        assert body["total"] == 0
        assert body["totalPages"] == 0
        assert body["hasPrev"] is False
        assert body["hasNext"] is False


class TestDatabaseFailures:
    def test_search_returns_503_when_db_fails(self, monkeypatch):
        from fastapi.testclient import TestClient
        from tests.conftest import FakeCollection

        monkeypatch.setattr(main, "collection", FakeCollection(find_error=True))
        response = TestClient(main.app).get("/properties/search")
        assert response.status_code == 503
        assert "unavailable" in response.json()["detail"].lower()

    def test_cities_returns_503_when_db_fails(self, monkeypatch):
        from fastapi.testclient import TestClient
        from tests.conftest import FakeCollection

        monkeypatch.setattr(main, "collection", FakeCollection(distinct_error=True))
        response = TestClient(main.app).get("/properties/cities")
        assert response.status_code == 503


class TestCitiesEndpoint:
    def test_sorted_distinct_cities(self, client):
        body = client.get("/properties/cities").json()
        assert body["cities"] == ["Fairfax", "Reston", "Springfield", "Vienna"]

    def test_empty_db_returns_empty_list(self, monkeypatch):
        from fastapi.testclient import TestClient
        from tests.conftest import FakeCollection

        monkeypatch.setattr(main, "collection", FakeCollection([]))
        assert TestClient(main.app).get("/properties/cities").json() == {"cities": []}


class TestExistingEndpoints:
    """Smoke tests that pre-existing endpoints still behave."""

    def test_root(self, client):
        assert client.get("/").json() == {"message": "Hello World"}

    def test_ingest_rejects_empty_list(self, client):
        response = client.post("/ingest", json=[])
        assert response.status_code == 400
        assert "empty" in response.json()["detail"].lower()

    def test_ingest_upserts_and_reports_counts(self, client, fake_collection):
        payload = [
            {
                "id": "NEW1",
                "source": "MLS_A",
                "address": "9 New St",
                "city": "Reston",
                "state": "VA",
                "zip": "20190",
                "price": 555000,
                "bedrooms": 3,
                "bathrooms": 2.0,
                "sqft": 1300,
                "latitude": 38.9,
                "longitude": -77.3,
                "listedDate": "2026-10-01",
                "status": "active",
                "description": "A test listing.",
            }
        ]
        response = client.post("/ingest", json=payload)
        assert response.status_code == 200
        assert response.json()["upserted_count"] == 1
        assert len(fake_collection.bulk_operations) == 1

    def test_properties_list_returns_docs(self, client):
        response = client.get("/properties/", params={"limit": 3, "skip": 0})
        assert response.status_code == 200
        assert len(response.json()) == 3
