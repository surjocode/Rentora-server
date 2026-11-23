
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { MongoClient, type Db } from "mongodb";

import equipmentRoutes from "./routes/equipment.routes.js";
import categoryRoutes from "./routes/category.routes.js";
import favoriteRoutes from "./routes/favorite.routes.js";
import userRoutes from "./routes/user.routes.js";
import adminRoutes from "./routes/admin.routes.js";
import uploadRoutes from "./routes/upload.routes.js";

// ==========================================
// ENVIRONMENT CONFIGURATION
// ==========================================

dotenv.config();

const app = express();

const PORT = Number(process.env.PORT ?? 5000);
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || "rentora";
const CLIENT_URL = process.env.CLIENT_URL;

if (!MONGODB_URI) {
  throw new Error("MONGODB_URI is missing from .env file.");
}

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error("PORT must be a valid port number.");
}

if (!CLIENT_URL) {
  throw new Error("CLIENT_URL is missing from .env file.");
}

// ==========================================
// MONGODB CONFIGURATION
// ==========================================

const client = new MongoClient(MONGODB_URI);

let db: Db | null = null;

// Connect to MongoDB
export async function connectToMongoDB(): Promise<Db> {
  try {
    await client.connect();

    db = client.db(DB_NAME);

    console.log("Successfully connected to MongoDB!");

    // Ensure equipment collection exists
    const collections = await db
      .listCollections({}, { nameOnly: true })
      .toArray();

    const equipmentExists = collections.some(
      (collection) => collection.name === "equipment"
    );

    if (!equipmentExists) {
      await db.createCollection("equipment");
      console.log("Equipment collection created!");
    } else {
      console.log("Equipment collection already exists!");
    }

    return db;
  } catch (error) {
    console.error("MongoDB connection failed:", error);
    throw error;
  }
}

// Get database instance
export function getDB(): Db {
  if (!db) {
    throw new Error("Database is not connected.");
  }

  return db;
}

// Get MongoDB client
export function getMongoClient(): MongoClient {
  return client;
}

// ==========================================
// MIDDLEWARES
// ==========================================

// CORS Middleware
app.use(
  cors({
    origin: CLIENT_URL,
    credentials: true,
  })
);

// JSON Middleware
app.use(express.json());

// ==========================================
// PUBLIC ROUTES
// ==========================================

// Home Route
app.get("/", (_req, res) => {
  res.status(200).send("Rentora API is running!");
});

// Health Check Route
app.get("/health", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "Rentora Server is healthy.",
  });
});

// ==========================================
// API ROUTES
// ==========================================

// Equipment Routes
app.use("/api/equipment", equipmentRoutes);

// Category Routes
app.use("/api/categories", categoryRoutes);

// Favorite Routes
app.use("/api/favorites", favoriteRoutes);

// User Routes
app.use("/api/users", userRoutes);

// Admin Routes
app.use("/api/admin", adminRoutes);

// Upload Routes
app.use("/api/upload", uploadRoutes);

// ==========================================
// NOT FOUND HANDLER
// ==========================================

app.use((_req, res) => {
  res.status(404).json({
    success: false,
    message: "API route not found.",
  });
});

// ==========================================
// SERVER STARTUP
// ==========================================

async function startServer(): Promise<void> {
  try {
    await connectToMongoDB();

    app.listen(PORT, () => {
      console.log(`Rentora server running on port ${PORT}.`);
    });
  } catch (error) {
    console.error("Server startup failed:", error);

    await client.close().catch(() => undefined);

    process.exit(1);
  }
}

startServer();
