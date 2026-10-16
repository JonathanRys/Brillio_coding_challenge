"""Shared fixtures for the server test suite.

The API tests never touch a real MongoDB: a small fake collection records the
filter it was asked to run and returns canned documents, which lets tests
assert both the filter construction and the ranking/pagination behaviour in
isolation.
"""

import os
import sys
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest

# Make server/ importable (main.py, search.py, config.py use flat imports).
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


class FakeCursor:
    """Mimics a Motor cursor: chainable skip/limit, awaited to_list, async for."""

    def __init__(self, docs):
        self._docs = [dict(d) for d in docs]

    def skip(self, n):
        self._docs = self._docs[n:]
        return self

    def limit(self, n):
        self._docs = self._docs[:n]
        return self

    async def to_list(self, length=None):
        return [dict(d) for d in self._docs]

    def __aiter__(self):
        self._iter = iter(self._docs)
        return self

    async def __anext__(self):
        try:
            return next(self._iter)
        except StopIteration:
            raise StopAsyncIteration


class FakeCollection:
    """Stand-in for the Motor collection used by main.py."""

    def __init__(self, docs=None, find_error=False, distinct_error=False):
        # Mongo always injects _id; mirror that so legacy endpoints behave.
        self.docs = [
            {**dict(d), "_id": d.get("_id", "oid-%d" % i)}
            for i, d in enumerate(docs or [])
        ]
        self.find_error = find_error
        self.distinct_error = distinct_error
        self.last_filter = None
        self.bulk_operations = None

    def find(self, filt=None):
        self.last_filter = filt or {}
        if self.find_error:
            raise RuntimeError("database unreachable")
        return FakeCursor(self.docs)

    async def distinct(self, field):
        if self.distinct_error:
            raise RuntimeError("database unreachable")
        return list({d[field] for d in self.docs if field in d})

    async def find_one(self, filt):
        return None

    async def bulk_write(self, operations, ordered=True):
        self.bulk_operations = list(operations)
        return SimpleNamespace(
            matched_count=0,
            modified_count=0,
            upserted_count=len(self.bulk_operations),
        )


def _iso_days_ago(days):
    return (datetime.now().replace(microsecond=0) - timedelta(days=days)).isoformat()


@pytest.fixture
def sample_docs():
    """A small, time-relative corpus so ranking assertions stay stable.

    Dates are relative to "now", so recency behaves the same whenever the
    suite runs. Prices are chosen to make budget-fit ordering unambiguous
    around a 500k target.
    """
    return [
        {
            "property_id": "T1",
            "source": "MLS_A",
            "address": "1 First St",
            "city": "Springfield",
            "state": "VA",
            "zip": "22150",
            "price": 500000.0,
            "bedrooms": 3,
            "bathrooms": 2.0,
            "sqft": 1200,
            "latitude": 38.8,
            "longitude": -77.2,
            "listedDate": _iso_days_ago(0),
            "status": "active",
            "description": "Renovated kitchen with quartz counters.",
        },
        {
            "property_id": "T2",
            "source": "MLS_B",
            "address": "2 Second Ave",
            "city": "Fairfax",
            "state": "VA",
            "zip": "22030",
            "price": 400000.0,
            "bedrooms": 2,
            "bathrooms": 1.0,
            "sqft": 900,
            "latitude": 38.85,
            "longitude": -77.3,
            "listedDate": _iso_days_ago(30),
            "status": "active",
            "description": "Cozy starter home near schools.",
        },
        {
            "property_id": "T3",
            "source": "MLS_A",
            "address": "3 Third Blvd",
            "city": "Reston",
            "state": "VA",
            "zip": "20190",
            "price": 620000.0,
            "bedrooms": 4,
            "bathrooms": 3.0,
            "sqft": 2000,
            "latitude": 38.95,
            "longitude": -77.35,
            "listedDate": _iso_days_ago(5),
            "status": "pending",
            "description": "Bright condo near shops and pool.",
        },
        {
            "property_id": "T4",
            "source": "MLS_C",
            "address": "4 Fourth Ct",
            "city": "Springfield",
            "state": "VA",
            "zip": "22151",
            "price": 480000.0,
            "bedrooms": 3,
            "bathrooms": 1.5,
            "sqft": 1100,
            "latitude": 38.78,
            "longitude": -77.19,
            "listedDate": _iso_days_ago(60),
            "status": "active",
            "description": "Top-floor condo, walk to shopping.",
        },
        {
            "property_id": "T5",
            "source": "MLS_A",
            "address": "5 Fifth Dr",
            "city": "Vienna",
            "state": "VA",
            "zip": "22180",
            "price": 510000.0,
            "bedrooms": 4,
            "bathrooms": 2.5,
            "sqft": 1800,
            "latitude": 38.9,
            "longitude": -77.26,
            "listedDate": _iso_days_ago(15),
            "status": "sold",
            "description": "Single-family home with a two-car garage.",
        },
    ]


@pytest.fixture
def fake_collection(sample_docs):
    return FakeCollection(sample_docs)


@pytest.fixture
def client(monkeypatch, fake_collection):
    """TestClient wired to main.py with the fake collection injected."""
    from fastapi.testclient import TestClient
    import main

    monkeypatch.setattr(main, "collection", fake_collection)
    return TestClient(main.app)
