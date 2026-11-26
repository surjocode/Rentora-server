
import { Router, type Request, type Response } from "express";
import { ObjectId } from "mongodb";

import { getDB } from "../server.js";
// import { verifyToken } from "../middleware/auth.middleware.js";

const router = Router();

// ==========================================
// TYPES
// ==========================================

interface Favorite {
  ownerEmail: string;
  equipmentId: ObjectId;
  createdAt: Date;
}

// ==========================================
// HELPERS
// ==========================================

const getUserEmail = (req: Request): string | null => {
  const email = req.user?.email;

  return typeof email === "string" && email.trim()
    ? email.trim().toLowerCase()
    : null;
};

const isValidObjectId = (id: unknown): id is string =>
  typeof id === "string" && ObjectId.isValid(id);

// Protect all favorite routes
// router.use(verifyToken);

// ==========================================
// ADD TO FAVORITES
// ==========================================

router.post("/", async (req: Request, res: Response) => {
  
  try {
    const { equipmentId } = req.body as {
      equipmentId?: unknown;
    };

    if (!isValidObjectId(equipmentId)) {
      return res.status(400).json({
        success: false,
        message: "A valid equipment ID is required.",
      });
    }

    const ownerEmail = getUserEmail(req);

    if (!ownerEmail) {
      return res.status(401).json({
        success: false,
        message: "User authentication required.",
      });
    }

    const db = getDB();
    const objectId = new ObjectId(equipmentId);

    // Only approved equipment can be added
    const equipment = await db.collection("equipment").findOne({
      _id: objectId,
      status: "approved",
    });

    if (!equipment) {
      return res.status(404).json({
        success: false,
        message: "Equipment not found.",
      });
    }

    const favoritesCollection =
      db.collection<Favorite>("favorites");

    const existingFavorite = await favoritesCollection.findOne({
      ownerEmail,
      equipmentId: objectId,
    });

    if (existingFavorite) {
      return res.status(409).json({
        success: false,
        message: "Equipment is already in favorites.",
      });
    }

    const newFavorite: Favorite = {
      ownerEmail,
      equipmentId: objectId,
      createdAt: new Date(),
    };

    const result = await favoritesCollection.insertOne(newFavorite);

    return res.status(201).json({
      success: true,
      message: "Equipment added to favorites successfully.",
      data: {
        _id: result.insertedId,
        ...newFavorite,
      },
    });
  } catch (error) {
    console.error("Add favorite error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to add favorite.",
    });
  }
});

// ==========================================
// GET MY FAVORITES
// ==========================================

router.get("/", async (req: Request, res: Response) => {
 
  try {
    const ownerEmail = getUserEmail(req);

    if (!ownerEmail) {
      return res.status(401).json({
        success: false,
        message: "User authentication required.",
      });
    }

    const db = getDB();

    const favorites = await db
      .collection<Favorite>("favorites")
      .aggregate([
        {
          $match: { ownerEmail },
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

    return res.status(200).json({
      success: true,
      message: "Favorites fetched successfully.",
      data: favorites,
    });
  } catch (error) {
    console.error("Get favorites error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch favorites.",
    });
  }
});

// ==========================================
// REMOVE FROM FAVORITES
// ==========================================

router.delete(
  "/:equipmentId",
  async (req: Request, res: Response) => {
    try {
      const { equipmentId } = req.params;

      if (!isValidObjectId(equipmentId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid equipment ID.",
        });
      }

      const ownerEmail = getUserEmail(req);

      if (!ownerEmail) {
        return res.status(401).json({
          success: false,
          message: "User authentication required.",
        });
      }

      const db = getDB();

      const result = await db
        .collection<Favorite>("favorites")
        .deleteOne({
          ownerEmail,
          equipmentId: new ObjectId(equipmentId),
        });

      if (result.deletedCount === 0) {
        return res.status(404).json({
          success: false,
          message: "Favorite not found.",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Favorite removed successfully.",
      });
    } catch (error) {
      console.error("Remove favorite error:", error);

      return res.status(500).json({
        success: false,
        message: "Failed to remove favorite.",
      });
    }
  }
);

export default router;
