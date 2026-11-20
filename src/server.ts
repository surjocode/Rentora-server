
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { MongoClient, type Db } from "mongodb";

import equipmentRoutes from "./routes/equipment.routes.js";
import categoryRoutes from "./routes/category.routes.js";
import favoriteRoutes from "./routes/favorite.routes.js";
import rentalRoutes from "./routes/rental.routes.js";
import userRoutes from "./routes/user.routes.js";
import adminRoutes from "./routes/admin.routes.js";
import uploadRoutes from "./routes/upload.routes.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  throw new Error("MONGODB_URI is missing from .env file");
}

const client = new MongoClient(MONGODB_URI);

let db: Db | null = null;

// MongoDB Connection
export async function connectToMongoDB(): Promise<Db> {
  try {
    await client.connect();

    db = client.db(process.env.DB_NAME || "rentora");

    console.log("Successfully connected to MongoDB!");

    const collections = await db.listCollections().toArray();

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

// Get Database
export function getDB(): Db {
  if (!db) {
    throw new Error("Database is not connected!");
  }

  return db;
}

// Middlewares
app.use(
  cors({
    origin: process.env.CLIENT_URL,
    credentials: true,
  })
);

app.use(express.json());

// Home Route
app.get("/", (_req, res) => {
  res.status(200).send("Rentora API is running!");
});

// Health Check Route
app.get("/health", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "Rentora Server is healthy",
  });
});



// Equipment Routes
app.use("/api/equipment", equipmentRoutes);
// Category Routes
app.use("/api/categories", categoryRoutes);
// Favorite Routes
app.use("/api/favorites", favoriteRoutes);
// Rental Routes
app.use("/api/rentals", rentalRoutes);
// User Routes
app.use("/api/users", userRoutes);
// Admin Routes
app.use("/api/admin", adminRoutes);

app.use("/api/upload", uploadRoutes);




// Not Found Route
app.use((_req, res) => {
  res.status(404).json({
    success: false,
    message: "API route not found",
  });
});

// Start Server
async function startServer() {
  try {
    await connectToMongoDB();

    app.listen(PORT);
  } catch (error) {
    console.error("Server startup failed:", error);
    process.exit(1);
  }
}

startServer();
