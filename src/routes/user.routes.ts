
import { Router, type Request, type Response } from "express";
import { getDB } from "../server.js";

const router = Router();

// User Interface
interface User {
  name?: string;
  email: string;
  image?: string;
  role?: "renter" | "owner" | "admin";
  createdAt?: Date;
  updatedAt?: Date;
}

// Get User Profile
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

    const user = await db.collection<User>("users").findOne(
      {
        email: email.trim().toLowerCase(),
      },
      {
        projection: {
          name: 1,
          email: 1,
          image: 1,
          role: 1,
          createdAt: 1,
        },
      }
    );

    if (!user) {
      res.status(404).json({
        success: false,
        message: "User not found",
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: "User profile fetched successfully",
      data: user,
    });
  } catch (error) {
    console.error("Get user profile error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch user profile",
    });
  }
});

// Update User Profile
router.patch("/:email", async (req: Request, res: Response) => {
  try {
    const email = req.params.email;
    const { name, image } = req.body;

    if (typeof email !== "string" || !email.trim()) {
      res.status(400).json({
        success: false,
        message: "Valid email is required",
      });
      return;
    }

    const updates: Partial<User> = {};

    if (name !== undefined) {
      if (typeof name !== "string" || !name.trim()) {
        res.status(400).json({
          success: false,
          message: "Name must be a valid string",
        });
        return;
      }

      updates.name = name.trim();
    }

    if (image !== undefined) {
      if (typeof image !== "string") {
        res.status(400).json({
          success: false,
          message: "Image must be a valid string",
        });
        return;
      }

      updates.image = image.trim();
    }

    if (Object.keys(updates).length === 0) {
      res.status(400).json({
        success: false,
        message: "No valid profile information provided",
      });
      return;
    }

    updates.updatedAt = new Date();

    const db = getDB();

    const result = await db.collection<User>("users").findOneAndUpdate(
      {
        email: email.trim().toLowerCase(),
      },
      {
        $set: updates,
      },
      {
        returnDocument: "after",
        projection: {
          name: 1,
          email: 1,
          image: 1,
          role: 1,
        },
      }
    );

    if (!result) {
      res.status(404).json({
        success: false,
        message: "User not found",
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: "User profile updated successfully",
      data: result,
    });
  } catch (error) {
    console.error("Update user profile error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to update user profile",
    });
  }
});

export default router;
