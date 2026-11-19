
import { Router, type Request, type Response } from "express";
import { ObjectId } from "mongodb";
import { getDB } from "../server.js";

const router = Router();

// Favorite Interface
interface Favorite {
  ownerEmail: string;
  equipmentId: ObjectId;
  createdAt: Date;
}

// Add to Favorites
router.post("/", async (req: Request, res: Response) => {
  try {
    const { ownerEmail, equipmentId } = req.body;

    if (!ownerEmail || !equipmentId) {
      res.status(400).json({
        success: false,
        message: "Email and equipment ID are required",
      });
      return;
    }

    if (typeof equipmentId !== "string" || !ObjectId.isValid(equipmentId)) {
      res.status(400).json({
        success: false,
        message: "Invalid equipment ID",
      });
      return;
    }

    const db = getDB();

    const equipment = await db.collection("equipment").findOne({
      _id: new ObjectId(equipmentId),
      status: "approved",
    });

    if (!equipment) {
      res.status(404).json({
        success: false,
        message: "Equipment not found",
      });
      return;
    }

    const favoritesCollection = db.collection<Favorite>("favorites");

    const existingFavorite = await favoritesCollection.findOne({
      ownerEmail: String(ownerEmail).trim().toLowerCase(),
      equipmentId: new ObjectId(equipmentId),
    });

    if (existingFavorite) {
      res.status(409).json({
        success: false,
        message: "Equipment is already in favorites",
      });
      return;
    }

    const newFavorite: Favorite = {
      ownerEmail: String(ownerEmail).trim().toLowerCase(),
      equipmentId: new ObjectId(equipmentId),
      createdAt: new Date(),
    };

    const result = await favoritesCollection.insertOne(newFavorite);

    res.status(201).json({
      success: true,
      message: "Equipment added to favorites successfully",
      data: {
        _id: result.insertedId,
        ...newFavorite,
      },
    });
  } catch (error) {
    console.error("Add favorite error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to add favorite",
    });
  }
});

// Get My Favorites
router.get("/:email", async (req: Request, res: Response) => {
  try {
    const email = req.params.email;

    if (typeof email !== "string" || !email.trim()) {
      res.status(400).json({
        success: false,
        message: "Valid email is required",
      });
      return;
    }

    const db = getDB();

    const favorites = await db
      .collection<Favorite>("favorites")
      .aggregate([
        {
          $match: {
            ownerEmail: email.trim().toLowerCase(),
          },
        },
        {
          $lookup: {
            from: "equipment",
            localField: "equipmentId",
            foreignField: "_id",
            as: "equipment",
          },
        },
        {
          $unwind: "$equipment",
        },
        {
          $match: {
            "equipment.status": "approved",
          },
        },
        {
          $sort: {
            createdAt: -1,
          },
        },
      ])
      .toArray();

    res.status(200).json({
      success: true,
      message: "Favorites fetched successfully",
      data: favorites,
    });
  } catch (error) {
    console.error("Get favorites error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch favorites",
    });
  }
});

// Remove from Favorites
router.delete("/:email/:equipmentId", async (req: Request, res: Response) => {
  try {
    const { email, equipmentId } = req.params;

    if (
      typeof email !== "string" ||
      typeof equipmentId !== "string" ||
      !email.trim() ||
      !ObjectId.isValid(equipmentId)
    ) {
      res.status(400).json({
        success: false,
        message: "Valid email and equipment ID are required",
      });
      return;
    }

    const db = getDB();

    const result = await db.collection<Favorite>("favorites").deleteOne({
      ownerEmail: email.trim().toLowerCase(),
      equipmentId: new ObjectId(equipmentId),
    });

    if (result.deletedCount === 0) {
      res.status(404).json({
        success: false,
        message: "Favorite not found",
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: "Favorite removed successfully",
    });
  } catch (error) {
    console.error("Remove favorite error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to remove favorite",
    });
  }
});

export default router;
