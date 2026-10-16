import asyncio
import json
import os
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ReplaceOne
from config import MONGO_DETAILS, DB_NAME, COLLECTION_NAME
# Configuration
DATA_FILE = "../data/sample_listings.json"


async def seed_database():
    print("Connecting to MongoDB...")
    client = AsyncIOMotorClient(MONGO_DETAILS)
    db = client[DB_NAME]
    collection = db[COLLECTION_NAME]

    print("Ensuring unique index exists for 'property_id'...")
    await collection.create_index("property_id", unique=True)

    if not os.path.exists(DATA_FILE):
        print(f"Error: {DATA_FILE} not found. Please create it first.")
        return

    with open(DATA_FILE, "r") as f:
        properties = json.load(f)

    if not properties:
        print("Seed file is empty. Nothing to insert.")
        return

    operations = []
    for prop in properties:
        doc = prop.copy()
        property_id = doc.pop("id")
        doc["property_id"] = property_id

        operations.append(
            ReplaceOne(
                filter={"property_id": property_id},
                replacement=doc,
                upsert=True,
            )
        )

    print(f"Sending {len(operations)} records to MongoDB...")
    try:
        result = await collection.bulk_write(operations, ordered=False)
        print("\n--- Seeding Completed Successfully ---")
        print(f"Matched records:  {result.matched_count}")
        print(f"Modified records: {result.modified_count}")
        print(f"Newly Upserted:   {result.upserted_count}")
    except Exception as e:
        print(f"Seeding failed: {str(e)}")
    finally:
        client.close()


if __name__ == "__main__":
    asyncio.run(seed_database())
