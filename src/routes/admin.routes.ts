
import { Router, type Request, type Response } from "express";
import { ObjectId } from "mongodb";
import { getDB } from "../server.js";
import {
  verifyToken,
  verifyAdmin,
} from "../middleware/auth.middleware.js";

const router = Router();

// Protect all Admin Routes
router.use(verifyToken, verifyAdmin);

// Get All Users
router.get("/users", async (_req: Request, res: Response) => {
  try {
    const db = getDB();

    const users = await db
      .collection("users")
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

    res.status(200).json({
      success: true,
      message: "Users fetched successfully",
      data: users,
    });
  } catch (error) {
    console.error("Get users error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch users",
    });
  }
});

// Update User Role
router.patch("/users/:id/role", async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const { role } = req.body;

    if (typeof id !== "string" || !ObjectId.isValid(id)) {
      res.status(400).json({
        success: false,
        message: "Invalid user ID",
      });
      return;
    }

    if (
      typeof role !== "string" ||
      !["renter", "owner", "admin"].includes(role)
    ) {
      res.status(400).json({
        success: false,
        message: "Invalid user role",
      });
      return;
    }

    const db = getDB();

    const result = await db.collection("users").updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          role,
          updatedAt: new Date(),
        },
      }
    );

    if (result.matchedCount === 0) {
      res.status(404).json({
        success: false,
        message: "User not found",
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: "User role updated successfully",
    });
  } catch (error) {
    console.error("Update user role error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to update user role",
    });
  }
});

// Approve or Reject Equipment
router.patch(
  "/equipment/:id/status",
  async (req: Request, res: Response) => {
    try {
      const id = req.params.id;
      const { status } = req.body;

      if (typeof id !== "string" || !ObjectId.isValid(id)) {
        res.status(400).json({
          success: false,
          message: "Invalid equipment ID",
        });
        return;
      }

      if (
        typeof status !== "string" ||
        !["approved", "rejected"].includes(status)
      ) {
        res.status(400).json({
          success: false,
          message: "Status must be approved or rejected",
        });
        return;
      }

      const db = getDB();

      const result = await db.collection("equipment").updateOne(
        {
          _id: new ObjectId(id),
          status: "pending",
        },
        {
          $set: {
            status,
            updatedAt: new Date(),
          },
        }
      );

      if (result.matchedCount === 0) {
        res.status(404).json({
          success: false,
          message: "Pending equipment not found",
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: `Equipment ${status} successfully`,
      });
    } catch (error) {
      console.error("Update equipment status error:", error);

      res.status(500).json({
        success: false,
        message: "Failed to update equipment status",
      });
    }
  }
);

// Get Admin Dashboard Statistics
router.get("/stats", async (_req: Request, res: Response) => {
  try {
    const db = getDB();

    const [
      totalUsers,
      totalEquipment,
      approvedEquipment,
      pendingEquipment,
      rejectedEquipment,
      totalRentals,
      pendingRentals,
      approvedRentals,
    ] = await Promise.all([
      db.collection("users").countDocuments(),
      db.collection("equipment").countDocuments(),
      db.collection("equipment").countDocuments({ status: "approved" }),
      db.collection("equipment").countDocuments({ status: "pending" }),
      db.collection("equipment").countDocuments({ status: "rejected" }),
      db.collection("rentals").countDocuments(),
      db.collection("rentals").countDocuments({ status: "pending" }),
      db.collection("rentals").countDocuments({ status: "approved" }),
    ]);

    res.status(200).json({
      success: true,
      message: "Admin statistics fetched successfully",
      data: {
        totalUsers,
        totalEquipment,
        approvedEquipment,
        pendingEquipment,
        rejectedEquipment,
        totalRentals,
        pendingRentals,
        approvedRentals,
      },
    });
  } catch (error) {
    console.error("Get admin stats error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch admin statistics",
    });
  }
});

export default router;
