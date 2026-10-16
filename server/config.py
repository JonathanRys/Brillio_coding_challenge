import os

MONGO_DETAILS = os.getenv("MONGO_DETAILS", "mongodb://localhost:27017")
DB_NAME = "property_database"
COLLECTION_NAME = "properties"