
import { Router, type Request, type Response } from "express";

import { getDB } from "../server.js";
import { verifyToken } from "../middleware/auth.middleware.js";

const router = Router();

// ==========================================
// TYPES
// ==========================================

interface User {
  name?: string;
  email: string;
  image?: string;
  role?: "renter" | "owner" | "admin";
  phone?: string;
  address?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

interface UpdateProfileBody {
  name?: unknown;
  image?: unknown;
  phone?: unknown;
  address?: unknown;
}

// ==========================================
// HELPERS
// ==========================================

const getUserEmail = (req: Request): string | null => {
  const email = req.user?.email;

  if (typeof email !== "string" || !email.trim()) {
    return null;
  }

  return email.trim().toLowerCase();
};

// ==========================================
// MIDDLEWARE
// ==========================================

// Protect all user routes
router.use(verifyToken);

// ==========================================
// GET LOGGED-IN USER PROFILE
// ==========================================

router.get("/", async (req: Request, res: Response): Promise<void> => {
  try {
    const email = getUserEmail(req);

    if (!email) {
      res.status(401).json({
        success: false,
        message: "User authentication required.",
      });
      return;
    }

    const db = getDB();

    // Better Auth default MongoDB collection name is "user"
    const user = await db.collection<User>("user").findOne(
      { email },
      {
        projection: {
          _id: 1,
          name: 1,
          email: 1,
          image: 1,
          role: 1,
          phone: 1,
          address: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      }
    );

    if (!user) {
      res.status(404).json({
        success: false,
        message: "User not found.",
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: "User profile fetched successfully.",
      data: user,
    });
  } catch (error) {
    console.error("Get user profile error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch user profile.",
    });
  }
});

// ==========================================
// UPDATE LOGGED-IN USER PROFILE
// ==========================================

router.patch("/", async (req: Request, res: Response): Promise<void> => {
  try {
    const email = getUserEmail(req);

    if (!email) {
      res.status(401).json({
        success: false,
        message: "User authentication required.",
      });
      return;
    }

    if (
      !req.body ||
      typeof req.body !== "object" ||
      Array.isArray(req.body)
    ) {
      res.status(400).json({
        success: false,
        message: "Invalid profile information.",
      });
      return;
    }

    const { name, image, phone, address } =
      req.body as UpdateProfileBody;

    const updates: Partial<
      Pick<User, "name" | "image" | "phone" | "address">
    > = {};

    // Validate name
    if (name !== undefined) {
      if (
        typeof name !== "string" ||
        !name.trim() ||
        name.trim().length > 100
      ) {
        res.status(400).json({
          success: false,
          message: "Name must be between 1 and 100 characters.",
        });
        return;
      }

      updates.name = name.trim();
    }

    // Validate profile image
    if (image !== undefined) {
      if (
        typeof image !== "string" ||
        image.trim().length > 2048
      ) {
        res.status(400).json({
          success: false,
          message: "Image must be a valid URL string.",
        });
        return;
      }

      const trimmedImage = image.trim();

      if (
        trimmedImage &&
        !/^https?:\/\/\S+$/i.test(trimmedImage)
      ) {
        res.status(400).json({
          success: false,
          message: "Please provide a valid image URL.",
        });
        return;
      }

      updates.image = trimmedImage;
    }

    // Validate phone
    if (phone !== undefined) {
      if (
        typeof phone !== "string" ||
        phone.trim().length > 30
      ) {
        res.status(400).json({
          success: false,
          message: "Phone number must not exceed 30 characters.",
        });
        return;
      }

      const trimmedPhone = phone.trim();

      if (
        trimmedPhone &&
        !/^\+?[0-9\s().-]+$/.test(trimmedPhone)
      ) {
        res.status(400).json({
          success: false,
          message: "Please provide a valid phone number.",
        });
        return;
      }

      updates.phone = trimmedPhone;
    }

    // Validate address
    if (address !== undefined) {
      if (
        typeof address !== "string" ||
        address.trim().length > 500
      ) {
        res.status(400).json({
          success: false,
          message: "Address must not exceed 500 characters.",
        });
        return;
      }

      updates.address = address.trim();
    }

    // Check whether there is anything to update
    if (Object.keys(updates).length === 0) {
      res.status(400).json({
        success: false,
        message: "No valid profile information provided.",
      });
      return;
    }

    const db = getDB();

    const result = await db.collection<User>("user").updateOne(
      { email },
      {
        $set: {
          ...updates,
          updatedAt: new Date(),
        },
      }
    );

    if (result.matchedCount === 0) {
      res.status(404).json({
        success: false,
        message: "User not found.",
      });
      return;
    }

    // Fetch updated profile
    const updatedUser = await db.collection<User>("user").findOne(
      { email },
      {
        projection: {
          _id: 1,
          name: 1,
          email: 1,
          image: 1,
          role: 1,
          phone: 1,
          address: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      }
    );

    res.status(200).json({
      success: true,
      message: "User profile updated successfully.",
      data: updatedUser,
    });
  } catch (error) {
    console.error("Update user profile error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to update user profile.",
    });
  }
});

export default router;
