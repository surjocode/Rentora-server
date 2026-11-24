
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
import rentalRoutes from "./routes/rental.routes.js";
import paymentRoutes from "./routes/payment.routes.js";

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
  throw new Error("MONGODB_URI is missing.");
}

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error("PORT must be a valid port number.");
}

if (!CLIENT_URL) {
  throw new Error("CLIENT_URL is missing.");
}

// ==========================================
// MONGODB CONFIGURATION
// ==========================================

const client = new MongoClient(MONGODB_URI);

let db: Db | null = null;
let connectionPromise: Promise<Db> | null = null;

export async function connectToMongoDB(): Promise<Db> {
  if (db) {
    return db;
  }

  if (!connectionPromise) {
    connectionPromise = (async () => {
      await client.connect();

      db = client.db(DB_NAME);

      console.log("Successfully connected to MongoDB!");

      const collections = await db
        .listCollections({}, { nameOnly: true })
        .toArray();

      const equipmentExists = collections.some(
        (collection) => collection.name === "equipment"
      );

      if (!equipmentExists) {
        await db.createCollection("equipment");
        console.log("Equipment collection created!");
      }

      return db;
    })().catch((error) => {
      connectionPromise = null;
      throw error;
    });
  }

  return connectionPromise;
}

export function getDB(): Db {
  if (!db) {
    throw new Error("Database is not connected.");
  }

  return db;
}

export function getMongoClient(): MongoClient {
  return client;
}

// ==========================================
// MIDDLEWARES
// ==========================================

app.use(
  cors({
    origin: CLIENT_URL,
    credentials: true,
  })
);

// Stripe Webhook Raw Body Middleware
// Must be before express.json()

app.use(
  "/api/payments/webhook",
  express.raw({ type: "application/json" })
);

app.use(express.json());

// ==========================================
// PUBLIC ROUTES
// ==========================================

app.get("/", (_req, res) => {
  res.status(200).send("Rentora API is running!");
});

app.get("/health", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "Rentora Server is healthy.",
  });
});

// ==========================================
// API ROUTES
// ==========================================

app.use("/api/equipment", equipmentRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/favorites", favoriteRoutes);
app.use("/api/users", userRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/rentals", rentalRoutes);
app.use("/api/payments", paymentRoutes);

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
// EXPORT EXPRESS APP
// ==========================================

export default app;

// ==========================================
// LOCAL DEVELOPMENT SERVER
// ==========================================

if (process.env.NODE_ENV !== "production") {
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
}
