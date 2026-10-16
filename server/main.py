from typing import List, Optional
from fastapi import FastAPI, Query, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field
from pymongo import ReplaceOne
import datetime
import math
import re
from config import MONGO_DETAILS, DB_NAME, COLLECTION_NAME
from search import rank_listings, BUDGET_WEIGHT, RECENCY_WEIGHT, HALF_LIFE_DAYS
app = FastAPI()

client = AsyncIOMotorClient(MONGO_DETAILS)
db = client[DB_NAME] 
collection = db[COLLECTION_NAME]  

origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class Property(BaseModel):
    id: str = Field(..., description="The external or source ID of the property")
    source: str
    address: str
    city: str
    state: str
    zip: str
    price: float
    bedrooms: int
    bathrooms: float
    sqft: Optional[int] = None
    latitude: float
    longitude: float
    listedDate: datetime.datetime
    status: str
    description: Optional[str] = None


@app.post(
    "/ingest",
    status_code=status.HTTP_200_OK,
    summary="Ingest and upsert multiple property records",
)
async def ingest_properties(properties: List[Property]):
    if not properties:
        raise HTTPException(
            status_code=400, detail="The property list cannot be empty"
        )

    operations = []

    for prop in properties:
        doc = prop.model_dump()
        property_id = doc.pop("id")
        doc["property_id"] = property_id

        operations.append(
            ReplaceOne(filter={"property_id": property_id}, replacement=doc, upsert=True)
        )

    try:
        result = await collection.bulk_write(operations, ordered=False)

        return {
            "message": "Ingestion complete",
            "matched_count": result.matched_count,
            "modified_count": result.modified_count,
            "upserted_count": result.upserted_count,
        }
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Bulk upsert failed: {str(e)}"
        )


@app.get("/")
async def root():
    return {"message": "Hello World"}


@app.post("/properties/")
async def create_property(property: Property):
    # Insert document into MongoDB
    new_property = await collection.insert_one(property.model_dump())
    return {"id": str(new_property.inserted_id), "message": "Property created successfully"}


@app.get(
    "/properties/",
    response_model=List[dict],
    summary="Get a paginated list of properties",
)
async def get_properties(
    limit: int = Query(default=10, ge=1, le=100, description="Number of records to return"),
    skip: int = Query(default=0, ge=0, description="Number of records to skip"),
):
    properties = []

    # 1. Fetch documents asynchronously using skip and limit chains
    # MongoDB handles this optimizations efficiently natively
    cursor = collection.find().skip(skip).limit(limit)

    print(f"Fetching properties with limit: {limit} and skip: {skip}")
    print(f"Properties: {properties}")

    async for prop in cursor:
        # Convert MongoDB ObjectId to string for JSON serialization
        prop["_id"] = str(prop["_id"])
        properties.append(prop)

    return properties


@app.get("/property/{property_id}")
async def get_property(property_id: str) -> Property:
    prop = await collection.find_one({"_id": property_id})
    if prop:
        prop["_id"] = str(prop["_id"])
        return prop
    else:
        return {"message": "Property not found"}


# ---------------------------------------------------------------------------
# Search
# ---------------------------------------------------------------------------

# Bound on pageSize: small enough to keep the ranked payload light, large
# enough to page through results quickly. Enforced server-side regardless of
# what the UI offers.
MAX_PAGE_SIZE = 50
MAX_KEYWORD_LENGTH = 100


class ScoreBreakdown(BaseModel):
    """Per-listing relevance components, surfaced in the UI."""

    budgetFit: Optional[float] = Field(
        None, description="0-1 budget fit; null when no targetBudget was given"
    )
    recency: float = Field(..., description="0-1 recency score (30-day half-life)")
    ageDays: Optional[int] = Field(None, description="Days since listed; null if unknown")


class SearchResult(BaseModel):
    property_id: str
    source: str
    address: str
    city: str
    state: str
    zip: str
    price: float
    bedrooms: int
    bathrooms: float
    sqft: Optional[int] = None
    latitude: float
    longitude: float
    listedDate: Optional[str] = None
    status: str
    description: Optional[str] = None
    score: float = Field(..., description="Relevance score, 0-100")
    scoreBreakdown: ScoreBreakdown


class RankingInfo(BaseModel):
    """Echoes how the ranking was computed so the UI can explain it."""

    mode: str  # "budget+recency" or "recency-only"
    budgetWeight: float
    recencyWeight: float
    halfLifeDays: int


class SearchResponse(BaseModel):
    items: List[SearchResult]
    page: int
    pageSize: int
    total: int
    totalPages: int
    hasNext: bool
    hasPrev: bool
    ranking: RankingInfo


def _validation_error(field: str, message: str) -> HTTPException:
    """Build a 422 whose shape matches FastAPI's own validation errors.

    Every deliberate validation failure in the search endpoint uses this so
    the frontend can parse a single, uniform error shape:
    {"detail": [{"loc": ["query", "<field>"], "msg": "...", "type": "..."}]}
    """
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail=[{"loc": ["query", field], "msg": message, "type": "value_error"}],
    )


@app.get(
    "/properties/search",
    response_model=SearchResponse,
    summary="Filter, rank, and paginate property listings",
)
async def search_properties(
    minPrice: Optional[float] = Query(default=None, description="Minimum price (inclusive)"),
    maxPrice: Optional[float] = Query(default=None, description="Maximum price (inclusive)"),
    minBedrooms: Optional[int] = Query(
        default=None, ge=0, le=20, description="Minimum bedrooms (inclusive)"
    ),
    city: Optional[str] = Query(
        default=None, description="City, exact match (case-insensitive)"
    ),
    keyword: Optional[str] = Query(
        default=None,
        description="Free-text keyword matched case-insensitively against the description",
    ),
    targetBudget: Optional[float] = Query(
        default=None, description="Target budget used for relevance ranking"
    ),
    page: int = Query(default=1, ge=1, description="1-based page number"),
    pageSize: int = Query(
        default=10,
        ge=1,
        le=MAX_PAGE_SIZE,
        description="Results per page (1-%d)" % MAX_PAGE_SIZE,
    ),
):
    """Search listings: hard filters first, then relevance ranking + pagination.

    Hard filters (applied in MongoDB): minPrice, maxPrice, minBedrooms, city,
    keyword. Ranking: see search.rank_listings — budget fit + recency when
    targetBudget is given, recency-only otherwise.
    """
    # --- Deliberate input validation (cross-field, beyond Query bounds) ----
    if minPrice is not None and minPrice < 0:
        raise _validation_error("minPrice", "minPrice must be zero or greater.")
    if maxPrice is not None and maxPrice < 0:
        raise _validation_error("maxPrice", "maxPrice must be zero or greater.")
    if minPrice is not None and maxPrice is not None and minPrice > maxPrice:
        raise _validation_error(
            "minPrice",
            "minPrice (%g) cannot be greater than maxPrice (%g)." % (minPrice, maxPrice),
        )
    if targetBudget is not None and targetBudget <= 0:
        raise _validation_error("targetBudget", "targetBudget must be greater than zero.")

    # Trim and bound free-text inputs; treat blanks as "not provided".
    city = city.strip() if city else None
    if not city:
        city = None
    elif len(city) > MAX_KEYWORD_LENGTH:
        raise _validation_error(
            "city", "city must be %d characters or fewer." % MAX_KEYWORD_LENGTH
        )

    keyword = keyword.strip() if keyword else None
    if not keyword:
        keyword = None
    elif len(keyword) > MAX_KEYWORD_LENGTH:
        raise _validation_error(
            "keyword", "keyword must be %d characters or fewer." % MAX_KEYWORD_LENGTH
        )

    # --- Build the hard-filter query --------------------------------------
    mongo_filter = {}

    price_clause = {}
    if minPrice is not None:
        price_clause["$gte"] = minPrice
    if maxPrice is not None:
        price_clause["$lte"] = maxPrice
    if price_clause:
        mongo_filter["price"] = price_clause

    if minBedrooms is not None:
        mongo_filter["bedrooms"] = {"$gte": minBedrooms}

    if city:
        # Anchored, escaped, case-insensitive exact match.
        mongo_filter["city"] = {"$regex": r"^%s$" % re.escape(city), "$options": "i"}

    if keyword:
        # Escaped substring match against the description.
        mongo_filter["description"] = {"$regex": re.escape(keyword), "$options": "i"}

    # --- Fetch candidates, rank, then paginate ----------------------------
    try:
        candidates = await collection.find(mongo_filter).to_list(length=None)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The listing database is unavailable. Please try again shortly.",
        )

    for doc in candidates:
        doc.pop("_id", None)

    ranked = rank_listings(candidates, target_budget=targetBudget)

    total = len(ranked)
    total_pages = math.ceil(total / pageSize) if total else 0
    # A page beyond the end is not an error — return an empty page so the UI
    # can show a "no results on this page" state instead of blowing up.
    start = (page - 1) * pageSize
    page_items = ranked[start : start + pageSize]

    items = []
    for item in page_items:
        breakdown = ScoreBreakdown(
            budgetFit=item.pop("budgetFit"),
            recency=item.pop("recency"),
            ageDays=item.pop("ageDays"),
        )
        items.append(SearchResult(scoreBreakdown=breakdown, **item))

    ranking = RankingInfo(
        mode="budget+recency" if targetBudget is not None else "recency-only",
        budgetWeight=BUDGET_WEIGHT if targetBudget is not None else 0.0,
        recencyWeight=RECENCY_WEIGHT if targetBudget is not None else 1.0,
        halfLifeDays=HALF_LIFE_DAYS,
    )

    return SearchResponse(
        items=items,
        page=page,
        pageSize=pageSize,
        total=total,
        totalPages=total_pages,
        hasNext=start + pageSize < total,
        hasPrev=page > 1 and start > 0,
        ranking=ranking,
    )


@app.get(
    "/properties/cities",
    summary="List distinct cities present in the data",
)
async def get_cities():
    """Distinct city names (sorted) to power the city filter dropdown."""
    try:
        cities = await collection.distinct("city")
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The listing database is unavailable. Please try again shortly.",
        )
    return {"cities": sorted(c for c in cities if c)}

