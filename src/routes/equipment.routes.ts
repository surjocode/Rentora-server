
import { Router, type Request, type Response } from "express";
import { ObjectId } from "mongodb";
import { getDB } from "../server.js";
import {
  verifyToken,
  verifyOwner,
} from "../middleware/auth.middleware.js";

const router = Router();

// Equipment Interface
interface Equipment {
  name: string;
  description: string;
  category: string;
  pricePerDay: number;
  location: string;
  image: string;
  ownerEmail: string;
  status: "pending" | "approved" | "rejected";
  createdAt: Date;
  updatedAt: Date;
}

// Get All Approved Equipment
router.get("/", async (_req: Request, res: Response) => {
  try {
    const db = getDB();

    const equipment = await db
      .collection<Equipment>("equipment")
      .find({ status: "approved" })
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).json({
      success: true,
      message: "Equipment fetched successfully",
      data: equipment,
    });
  } catch (error) {
    console.error("Get equipment error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch equipment",
    });
  }
});

// Get Single Approved Equipment
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const id = req.params.id;

    if (typeof id !== "string" || !ObjectId.isValid(id)) {
      res.status(400).json({
        success: false,
        message: "Invalid equipment ID",
      });
      return;
    }

    const db = getDB();

    const equipment = await db
      .collection<Equipment>("equipment")
      .findOne({
        _id: new ObjectId(id),
        status: "approved",
      });

    if (!equipment) {
      res.status(404).json({
        success: false,
        message: "Equipment not found",
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: equipment,
    });
  } catch (error) {
    console.error("Get single equipment error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch equipment",
    });
  }
});

// Add New Equipment (Owner Only)
router.post(
  "/",
  verifyToken,
  verifyOwner,
  async (req: Request, res: Response) => {
    try {
      const {
        name,
        description,
        category,
        pricePerDay,
        location,
        image,
      } = req.body;

      if (
        !name ||
        !description ||
        !category ||
        pricePerDay === undefined ||
        !location ||
        !image
      ) {
        res.status(400).json({
          success: false,
          message: "Please provide all required equipment information",
        });
        return;
      }

      const price = Number(pricePerDay);

      if (!Number.isFinite(price) || price <= 0) {
        res.status(400).json({
          success: false,
          message: "Price per day must be a positive number",
        });
        return;
      }

      const ownerEmail = req.user?.email;

      if (!ownerEmail) {
        res.status(401).json({
          success: false,
          message: "User authentication required",
        });
        return;
      }

      const db = getDB();

      const newEquipment: Equipment = {
        name: String(name).trim(),
        description: String(description).trim(),
        category: String(category).trim(),
        pricePerDay: price,
        location: String(location).trim(),
        image: String(image).trim(),
        ownerEmail: ownerEmail.toLowerCase(),
        status: "pending",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await db
        .collection<Equipment>("equipment")
        .insertOne(newEquipment);

      res.status(201).json({
        success: true,
        message: "Equipment added successfully",
        data: {
          _id: result.insertedId,
          ...newEquipment,
        },
      });
    } catch (error) {
      console.error("Add equipment error:", error);

      res.status(500).json({
        success: false,
        message: "Failed to add equipment",
      });
    }
  }
);

// Update Equipment (Owner or Admin)
router.patch(
  "/:id",
  verifyToken,
  async (req: Request, res: Response) => {
    try {
      const id = req.params.id;

      if (typeof id !== "string" || !ObjectId.isValid(id)) {
        res.status(400).json({
          success: false,
          message: "Invalid equipment ID",
        });
        return;
      }

      const user = req.user;

      if (!user || !["owner", "admin"].includes(user.role)) {
        res.status(403).json({
          success: false,
          message: "Only owners or admins can update equipment",
        });
        return;
      }

      const {
        name,
        description,
        category,
        pricePerDay,
        location,
        image,
      } = req.body;

      const updates: Partial<Equipment> = {};

      if (name !== undefined) updates.name = String(name).trim();
      if (description !== undefined)
        updates.description = String(description).trim();
      if (category !== undefined) updates.category = String(category).trim();
      if (location !== undefined) updates.location = String(location).trim();
      if (image !== undefined) updates.image = String(image).trim();

      if (pricePerDay !== undefined) {
        const price = Number(pricePerDay);

        if (!Number.isFinite(price) || price <= 0) {
          res.status(400).json({
            success: false,
            message: "Price per day must be a positive number",
          });
          return;
        }

        updates.pricePerDay = price;
      }

      if (Object.keys(updates).length === 0) {
        res.status(400).json({
          success: false,
          message: "No valid update information provided",
        });
        return;
      }

      updates.updatedAt = new Date();

      const db = getDB();

      const filter =
        user.role === "admin"
          ? { _id: new ObjectId(id) }
          : {
              _id: new ObjectId(id),
              ownerEmail: user.email.toLowerCase(),
            };

      const updatedEquipment = await db
        .collection<Equipment>("equipment")
        .findOneAndUpdate(
          filter,
          { $set: updates },
          { returnDocument: "after" }
        );

      if (!updatedEquipment) {
        res.status(404).json({
          success: false,
          message: "Equipment not found or you do not own it",
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: "Equipment updated successfully",
        data: updatedEquipment,
      });
    } catch (error) {
      console.error("Update equipment error:", error);

      res.status(500).json({
        success: false,
        message: "Failed to update equipment",
      });
    }
  }
);

// Delete Equipment (Owner or Admin)
router.delete(
  "/:id",
  verifyToken,
  async (req: Request, res: Response) => {
    try {
      const id = req.params.id;

      if (typeof id !== "string" || !ObjectId.isValid(id)) {
        res.status(400).json({
          success: false,
          message: "Invalid equipment ID",
        });
        return;
      }

      const user = req.user;

      if (!user || !["owner", "admin"].includes(user.role)) {
        res.status(403).json({
          success: false,
          message: "Only owners or admins can delete equipment",
        });
        return;
      }

      const db = getDB();

      const filter =
        user.role === "admin"
          ? { _id: new ObjectId(id) }
          : {
              _id: new ObjectId(id),
              ownerEmail: user.email.toLowerCase(),
            };

      const result = await db
        .collection<Equipment>("equipment")
        .deleteOne(filter);

      if (result.deletedCount === 0) {
        res.status(404).json({
          success: false,
          message: "Equipment not found or you do not own it",
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: "Equipment deleted successfully",
      });
    } catch (error) {
      console.error("Delete equipment error:", error);

      res.status(500).json({
        success: false,
        message: "Failed to delete equipment",
      });
    }
  }
);

export default router;
