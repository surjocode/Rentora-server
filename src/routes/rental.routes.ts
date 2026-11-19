
import { Router, type Request, type Response } from "express";
import { ObjectId } from "mongodb";
import { getDB } from "../server.js";

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

// Create Rental Request
router.post("/", async (req: Request, res: Response) => {
  try {
    const { equipmentId, renterEmail, startDate, endDate } = req.body;

    if (
      typeof equipmentId !== "string" ||
      typeof renterEmail !== "string" ||
      typeof startDate !== "string" ||
      typeof endDate !== "string" ||
      !renterEmail.trim()
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

    const db = getDB();

    const equipment = await db
      .collection<Equipment>("equipment")
      .findOne({
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

    const existingRental = await db
      .collection<Rental>("rentals")
      .findOne({
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
      (rentalEnd.getTime() - rentalStart.getTime()) /
        (1000 * 60 * 60 * 24)
    );

    const newRental: Rental = {
      equipmentId: new ObjectId(equipmentId),
      renterEmail: renterEmail.trim().toLowerCase(),
      ownerEmail: equipment.ownerEmail,
      startDate: rentalStart,
      endDate: rentalEnd,
      totalDays,
      totalPrice: totalDays * equipment.pricePerDay,
      status: "pending",
      paymentStatus: "unpaid",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await db
      .collection<Rental>("rentals")
      .insertOne(newRental);

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

// Get My Rentals
router.get("/my/:email", async (req: Request, res: Response) => {
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

    const rentals = await db
      .collection<Rental>("rentals")
      .aggregate([
        {
          $match: {
            renterEmail: email.trim().toLowerCase(),
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

// Get Owner Rental Requests
router.get("/owner/:email", async (req: Request, res: Response) => {
  try {
    const email = req.params.email;

    if (typeof email !== "string" || !email.trim()) {
      res.status(400).json({
        success: false,
        message: "Valid owner email is required",
      });
      return;
    }

    const db = getDB();

    const rentals = await db
      .collection<Rental>("rentals")
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

// Approve or Reject Rental
router.patch("/:id/status", async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const { status, ownerEmail } = req.body;

    if (typeof id !== "string" || !ObjectId.isValid(id)) {
      res.status(400).json({
        success: false,
        message: "Invalid rental ID",
      });
      return;
    }

    if (
      !["approved", "rejected"].includes(status) ||
      typeof ownerEmail !== "string" ||
      !ownerEmail.trim()
    ) {
      res.status(400).json({
        success: false,
        message: "Valid status and owner email are required",
      });
      return;
    }

    const db = getDB();

    const result = await db.collection<Rental>("rentals").updateOne(
      {
        _id: new ObjectId(id),
        ownerEmail: ownerEmail.trim().toLowerCase(),
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
});

// Cancel Rental
router.patch("/:id/cancel", async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const { renterEmail } = req.body;

    if (
      typeof id !== "string" ||
      !ObjectId.isValid(id) ||
      typeof renterEmail !== "string" ||
      !renterEmail.trim()
    ) {
      res.status(400).json({
        success: false,
        message: "Valid rental ID and renter email are required",
      });
      return;
    }

    const db = getDB();

    const result = await db.collection<Rental>("rentals").updateOne(
      {
        _id: new ObjectId(id),
        renterEmail: renterEmail.trim().toLowerCase(),
        status: "pending",
      },
      {
        $set: {
          status: "cancelled",
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
      message: "Rental cancelled successfully",
    });
  } catch (error) {
    console.error("Cancel rental error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to cancel rental",
    });
  }
});

export default router;
