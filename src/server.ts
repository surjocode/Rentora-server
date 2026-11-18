
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { MongoClient } from 'mongodb';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;



const client = new MongoClient (process.env.MONGODB_URI as string)

export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.dir(err);
  }
}

const dbClient = await connectToMongoDB();

app.use(
  cors({
    origin: process.env.CLIENT_URL,
    credentials: true,
  })
);

app.use(express.json());

app.get("/", (_req, res) => {
  res.send("Rentora API is running!");
});

app.get("/health", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "Rentora Server is healthy",
  });
});

app.listen(PORT, () => {
  console.log(`Rentora Server running on port ${PORT}`);
});
