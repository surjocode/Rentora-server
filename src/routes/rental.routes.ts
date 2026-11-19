import { Router, type Request, type Response } from "express";
import { ObjectId } from "mongodb";
import { getDB } from "../server.js";
import {
  verifyToken,
  verifyRenter,
  verifyOwner,
} from "../middleware/auth.middleware.js";

const router = Router();

// Rental Interface
interface Rental {
  equipmentId: ObjectId;
  renterEmail: string;
  ownerEmail: string;
  startDate: Date;
  endDate: Date;
  totalDays: number;
  totalPrice: number;
  status: "pending" | "approved" | "rejected" | "cancelled";
  paymentStatus: "unpaid" | "paid";
  createdAt: Date;
  updatedAt: Date;
}

// Equipment Interface
interface Equipment {
  name: string;
  pricePerDay: number;
  ownerEmail: string;
  status: string;
}

// Protect All Rental Routes
router.use(verifyToken);

// Create Rental Request (Renter Only)
router.post("/", verifyRenter, async (req: Request, res: Response) => {
  try {
    const { equipmentId, startDate, endDate } = req.body;

    if (
      typeof equipmentId !== "string" ||
      typeof startDate !== "string" ||
      typeof endDate !== "string"
    ) {
      res.status(400).json({
        success: false,
        message: "Please provide valid rental information",
      });
      return;
    }

    if (!ObjectId.isValid(equipmentId)) {
      res.status(400).json({
        success: false,
        message: "Invalid equipment ID",
      });
      return;
    }

    const rentalStart = new Date(startDate);
    const rentalEnd = new Date(endDate);

    if (
      Number.isNaN(rentalStart.getTime()) ||
      Number.isNaN(rentalEnd.getTime()) ||
      rentalEnd <= rentalStart
    ) {
      res.status(400).json({
        success: false,
        message: "Please provide valid rental dates",
      });
      return;
    }

    const renterEmail = req.user?.email;

    if (!renterEmail) {
      res.status(401).json({
        success: false,
        message: "User authentication required",
      });
      return;
    }

    const db = getDB();

    const equipment = await db.collection<Equipment>("equipment").findOne({
      _id: new ObjectId(equipmentId),
      status: "approved",
    });

    if (!equipment) {
      res.status(404).json({
        success: false,
        message: "Equipment not found or not available",
      });
      return;
    }

    if (equipment.ownerEmail.toLowerCase() === renterEmail.toLowerCase()) {
      res.status(400).json({
        success: false,
        message: "You cannot rent your own equipment",
      });
      return;
    }

    const existingRental = await db.collection<Rental>("rentals").findOne({
      equipmentId: new ObjectId(equipmentId),
      status: { $in: ["pending", "approved"] },
      startDate: { $lt: rentalEnd },
      endDate: { $gt: rentalStart },
    });

    if (existingRental) {
      res.status(409).json({
        success: false,
        message: "Equipment is already booked for these dates",
      });
      return;
    }

    const totalDays = Math.ceil(
      (rentalEnd.getTime() - rentalStart.getTime()) / (1000 * 60 * 60 * 24),
    );

    const newRental: Rental = {
      equipmentId: new ObjectId(equipmentId),
      renterEmail: renterEmail.toLowerCase(),
      ownerEmail: equipment.ownerEmail.toLowerCase(),
      startDate: rentalStart,
      endDate: rentalEnd,
      totalDays,
      totalPrice: totalDays * equipment.pricePerDay,
      status: "pending",
      paymentStatus: "unpaid",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await db.collection<Rental>("rentals").insertOne(newRental);

    res.status(201).json({
      success: true,
      message: "Rental request submitted successfully",
      data: {
        _id: result.insertedId,
        ...newRental,
      },
    });
  } catch (error) {
    console.error("Create rental error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to create rental request",
    });
  }
});

// Get My Rentals (Renter Only)
router.get("/my", verifyRenter, async (req: Request, res: Response) => {
  try {
    const renterEmail = req.user?.email;

    if (!renterEmail) {
      res.status(401).json({
        success: false,
        message: "User authentication required",
      });
      return;
    }

    const db = getDB();

    const rentals = await db
      .collection<Rental>("rentals")
      .aggregate([
        {
          $match: {
            renterEmail: renterEmail.toLowerCase(),
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
          $unwind: {
            path: "$equipment",
            preserveNullAndEmptyArrays: true,
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
      message: "My rentals fetched successfully",
      data: rentals,
    });
  } catch (error) {
    console.error("Get my rentals error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch rentals",
    });
  }
});

// Get Owner Rental Requests (Owner Only)
router.get("/owner", verifyOwner, async (req: Request, res: Response) => {
  try {
    const ownerEmail = req.user?.email;

    if (!ownerEmail) {
      res.status(401).json({
        success: false,
        message: "User authentication required",
      });
      return;
    }

    const db = getDB();

    const rentals = await db
      .collection<Rental>("rentals")
      .aggregate([
        {
          $match: {
            ownerEmail: ownerEmail.toLowerCase(),
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
          $unwind: {
            path: "$equipment",
            preserveNullAndEmptyArrays: true,
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
      message: "Owner rental requests fetched successfully",
      data: rentals,
    });
  } catch (error) {
    console.error("Get owner rentals error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch owner rental requests",
    });
  }
});

// Approve or Reject Rental (Owner Only)

router.patch(
  "/:id/status",
  verifyOwner,
  async (req: Request, res: Response) => {
    try {
      const id = req.params.id;
      const status = req.body.status;

      // Validate rental ID
      if (typeof id !== "string" || !ObjectId.isValid(id)) {
        res.status(400).json({
          success: false,
          message: "Invalid rental ID",
        });
        return;
      }

      // Validate rental status
      if (status !== "approved" && status !== "rejected") {
        res.status(400).json({
          success: false,
          message: "Status must be approved or rejected",
        });
        return;
      }

      // Get authenticated owner's email
      const ownerEmail = req.user?.email;

      if (!ownerEmail) {
        res.status(401).json({
          success: false,
          message: "User authentication required",
        });
        return;
      }

      const db = getDB();

      const result = await db.collection<Rental>("rentals").updateOne(
        {
          _id: new ObjectId(id),
          ownerEmail: ownerEmail.toLowerCase(),
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
          message: "Pending rental request not found",
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: `Rental request ${status} successfully`,
      });
    } catch (error) {
      console.error("Update rental status error:", error);

      res.status(500).json({
        success: false,
        message: "Failed to update rental status",
      });
    }
  }
);


// Cancel Rental (Renter Only)
router.patch(
  "/:id/cancel",
  verifyRenter,
  async (req: Request, res: Response) => {
    try {
      const id = req.params.id;

      if (typeof id !== "string" || !ObjectId.isValid(id)) {
        res.status(400).json({
          success: false,
          message: "Invalid rental ID",
        });
        return;
      }

      const renterEmail = req.user?.email;

      if (!renterEmail) {
        res.status(401).json({
          success: false,
          message: "User authentication required",
        });
        return;
      }

      const db = getDB();

      const result = await db.collection<Rental>("rentals").updateOne(
        {
          _id: new ObjectId(id),
          renterEmail: renterEmail.toLowerCase(),
          status: "pending",
        },
        {
          $set: {
            status: "cancelled",
            updatedAt: new Date(),
          },
        },
      );

      if (result.matchedCount === 0) {
        res.status(404).json({
          success: false,
          message: "Pending rental request not found",
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: "Rental cancelled successfully",
      });
    } catch (error) {
      console.error("Cancel rental error:", error);

      res.status(500).json({
        success: false,
        message: "Failed to cancel rental",
      });
    }
  },
);

export default router;
