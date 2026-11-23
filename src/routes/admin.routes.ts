
import { Router, type Request, type Response } from "express";
import { ObjectId } from "mongodb";

import { getDB } from "../server.js";
import {
  verifyToken,
  verifyAdmin,
} from "../middleware/auth.middleware.js";

const router = Router();

const USER_ROLES = ["renter", "owner", "admin"] as const;
const EQUIPMENT_STATUSES = [
  "pending",
  "approved",
  "rejected",
] as const;
const RENTAL_TYPES = ["daily", "weekly", "monthly"] as const;

type UserRole = (typeof USER_ROLES)[number];
type EquipmentStatus = (typeof EQUIPMENT_STATUSES)[number];
type RentalType = (typeof RENTAL_TYPES)[number];

type UpdateData = Record<string, unknown>;

const isValidId = (id: unknown): id is string =>
  typeof id === "string" && ObjectId.isValid(id);

const sendError = (
  res: Response,
  status: number,
  message: string
) => {
  return res.status(status).json({
    success: false,
    message,
  });
};

// Protect all admin routes
router.use(verifyToken, verifyAdmin);

// ==========================================
// GET ALL USERS
// ==========================================

router.get("/users", async (_req: Request, res: Response) => {
  try {
    const db = getDB();

    const users = await db
      .collection("user")
      .find(
        {},
        {
          projection: {
            name: 1,
            email: 1,
            image: 1,
            role: 1,
            createdAt: 1,
          },
        }
      )
      .sort({ createdAt: -1 })
      .toArray();

    return res.status(200).json({
      success: true,
      message: "Users fetched successfully.",
      data: users,
    });
  } catch (error) {
    console.error("Get users error:", error);

    return sendError(res, 500, "Failed to fetch users.");
  }
});

// ==========================================
// UPDATE USER ROLE
// ==========================================

router.patch(
  "/users/:id/role",
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { role } = req.body as { role?: unknown };

      if (!isValidId(id)) {
        return sendError(res, 400, "Invalid user ID.");
      }

      if (
        typeof role !== "string" ||
        !USER_ROLES.includes(role as UserRole)
      ) {
        return sendError(res, 400, "Invalid user role.");
      }

      const db = getDB();

      const adminEmail = req.user?.email?.toLowerCase();

      if (!adminEmail) {
        return sendError(res, 401, "Authentication required.");
      }

      const currentAdmin = await db.collection("user").findOne({
        email: adminEmail,
        role: "admin",
      });

      if (!currentAdmin) {
        return sendError(
          res,
          403,
          "Admin permission is no longer valid."
        );
      }

      const userId = new ObjectId(id);

      // Prevent changing own admin role
      if (currentAdmin._id.toString() === id) {
        return sendError(
          res,
          403,
          "You cannot change your own role."
        );
      }

      const result = await db.collection("user").updateOne(
        { _id: userId },
        {
          $set: {
            role,
            updatedAt: new Date(),
          },
        }
      );

      if (result.matchedCount === 0) {
        return sendError(res, 404, "User not found.");
      }

      return res.status(200).json({
        success: true,
        message: "User role updated successfully.",
      });
    } catch (error) {
      console.error("Update user role error:", error);

      return sendError(res, 500, "Failed to update user role.");
    }
  }
);

// ==========================================
// GET ALL EQUIPMENT
// ==========================================

router.get("/equipment", async (_req: Request, res: Response) => {
  try {
    const db = getDB();

    const equipment = await db
      .collection("equipment")
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    return res.status(200).json({
      success: true,
      message: "Equipment fetched successfully.",
      data: equipment,
    });
  } catch (error) {
    console.error("Get admin equipment error:", error);

    return sendError(res, 500, "Failed to fetch equipment.");
  }
});

// ==========================================
// APPROVE OR REJECT EQUIPMENT
// ==========================================


 // ==========================================
 // UPDATE EQUIPMENT STATUS
 // ==========================================

router.patch(
  "/equipment/:id/status",
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { status } = req.body as { status?: unknown };

      if (!isValidId(id)) {
        return sendError(res, 400, "Invalid equipment ID.");
      }

      if (
        typeof status !== "string" ||
        !EQUIPMENT_STATUSES.includes(status as EquipmentStatus)
      ) {
        return sendError(
          res,
          400,
          "Status must be pending, approved or rejected."
        );
      }

      const db = getDB();
      const equipmentId = new ObjectId(id);

      const result = await db.collection("equipment").updateOne(
        { _id: equipmentId },
        {
          $set: {
            status,
            updatedAt: new Date(),
          },
        }
      );

      if (result.matchedCount === 0) {
        return sendError(res, 404, "Equipment not found.");
      }

      const updatedEquipment = await db
        .collection("equipment")
        .findOne({ _id: equipmentId });

      return res.status(200).json({
        success: true,
        message: `Equipment status changed to ${status} successfully.`,
        data: updatedEquipment,
      });
    } catch (error) {
      console.error("Update equipment status error:", error);

      return sendError(
        res,
        500,
        "Failed to update equipment status."
      );
    }
  }
);


// ==========================================
// GET ADMIN DASHBOARD STATISTICS
// ==========================================

router.get("/stats", async (_req: Request, res: Response) => {
  try {
    const db = getDB();

    const [
      totalUsers,
      totalEquipment,
      approvedEquipment,
      pendingEquipment,
      rejectedEquipment,
    ] = await Promise.all([
      db.collection("user").countDocuments(),

      db.collection("equipment").countDocuments(),

      db.collection("equipment").countDocuments({
        status: "approved",
      }),

      db.collection("equipment").countDocuments({
        status: "pending",
      }),

      db.collection("equipment").countDocuments({
        status: "rejected",
      }),
    ]);

    return res.status(200).json({
      success: true,
      message: "Admin statistics fetched successfully.",
      data: {
        totalUsers,
        totalEquipment,
        approvedEquipment,
        pendingEquipment,
        rejectedEquipment,
      },
    });
  } catch (error) {
    console.error("Get admin stats error:", error);

    return sendError(
      res,
      500,
      "Failed to fetch admin statistics."
    );
  }
});

// ==========================================
// UPDATE EQUIPMENT
// ==========================================

router.patch(
  "/equipment/:id",
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      if (!isValidId(id)) {
        return sendError(res, 400, "Invalid equipment ID.");
      }

      const {
        name,
        description,
        category,
        rentalType,
        pricePerDay,
        availableQuantity,
        condition,
        brand,
        model,
        location,
        image,
        termsAndConditions,
      } = req.body;

      const updateData: UpdateData = {};

      const stringFields: Record<string, unknown> = {
        name,
        description,
        category,
        condition,
        brand,
        model,
        location,
        image,
        termsAndConditions,
      };

      // Validate string fields
      for (const [key, value] of Object.entries(stringFields)) {
        if (value === undefined) continue;

        if (typeof value !== "string" || !value.trim()) {
          return sendError(
            res,
            400,
            `${key} must be a non-empty string.`
          );
        }

        updateData[key] = value.trim();
      }

      // Validate rental pricing type
      if (rentalType !== undefined) {
        if (
          typeof rentalType !== "string" ||
          !RENTAL_TYPES.includes(rentalType as RentalType)
        ) {
          return sendError(res, 400, "Invalid rental type.");
        }

        updateData.rentalType = rentalType;
      }

      // Validate equipment price
      if (pricePerDay !== undefined) {
        if (
          typeof pricePerDay !== "number" ||
          !Number.isFinite(pricePerDay) ||
          pricePerDay <= 0
        ) {
          return sendError(
            res,
            400,
            "Price must be a positive number."
          );
        }

        updateData.pricePerDay = pricePerDay;
      }

      // Validate available quantity
      if (availableQuantity !== undefined) {
        if (
          typeof availableQuantity !== "number" ||
          !Number.isInteger(availableQuantity) ||
          availableQuantity < 0
        ) {
          return sendError(
            res,
            400,
            "Quantity must be a non-negative integer."
          );
        }

        updateData.availableQuantity = availableQuantity;
      }

      if (Object.keys(updateData).length === 0) {
        return sendError(
          res,
          400,
          "No valid fields provided for update."
        );
      }

      updateData.updatedAt = new Date();

      const db = getDB();
      const equipmentId = new ObjectId(id);

      const result = await db.collection("equipment").updateOne(
        { _id: equipmentId },
        { $set: updateData }
      );

      if (result.matchedCount === 0) {
        return sendError(res, 404, "Equipment not found.");
      }

      const updatedEquipment = await db
        .collection("equipment")
        .findOne({ _id: equipmentId });

      return res.status(200).json({
        success: true,
        message: "Equipment updated successfully.",
        data: updatedEquipment,
      });
    } catch (error) {
      console.error("Admin update equipment error:", error);

      return sendError(res, 500, "Failed to update equipment.");
    }
  }
);

// ==========================================
// DELETE EQUIPMENT
// ==========================================

router.delete(
  "/equipment/:id",
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      if (!isValidId(id)) {
        return sendError(res, 400, "Invalid equipment ID.");
      }

      const db = getDB();
      const equipmentId = new ObjectId(id);

      const result = await db.collection("equipment").deleteOne({
        _id: equipmentId,
      });

      if (result.deletedCount === 0) {
        return sendError(res, 404, "Equipment not found.");
      }

      return res.status(200).json({
        success: true,
        message: "Equipment deleted successfully.",
      });
    } catch (error) {
      console.error("Admin delete equipment error:", error);

      return sendError(res, 500, "Failed to delete equipment.");
    }
  }
);

export default router;
