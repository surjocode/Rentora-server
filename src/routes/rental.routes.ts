
import { Router, type Request, type Response } from "express";
import { ObjectId } from "mongodb";

import { getDB } from "../server.js";
import {
  verifyToken,
  verifyRenter,
  verifyOwner,
} from "../middleware/auth.middleware.js";

const router = Router();

interface Rental {
  equipmentId: ObjectId;
  renterEmail: string;
  ownerEmail: string;
  startDate: Date;
  endDate: Date;
  totalDays: number;
  totalPrice: number;
  paymentStatus: "unpaid" | "paid";
  stripePaymentIntentId?: string;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

interface Equipment {
  name: string;
  pricePerDay: number;
  ownerEmail: string;
  status: string;
}

router.use(verifyToken);

// Create Booking (Renter Only)
router.post(
  "/",
  verifyRenter,
  async (req: Request, res: Response) => {
    try {
      const { equipmentId, startDate, endDate } = req.body as {
        equipmentId?: string;
        startDate?: string;
        endDate?: string;
      };

      if (
        typeof equipmentId !== "string" ||
        typeof startDate !== "string" ||
        typeof endDate !== "string"
      ) {
        return res.status(400).json({
          success: false,
          message: "Please provide valid booking information.",
        });
      }

      if (!ObjectId.isValid(equipmentId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid equipment ID.",
        });
      }

      const rentalStart = new Date(startDate);
      const rentalEnd = new Date(endDate);

      if (
        Number.isNaN(rentalStart.getTime()) ||
        Number.isNaN(rentalEnd.getTime()) ||
        rentalEnd <= rentalStart
      ) {
        return res.status(400).json({
          success: false,
          message: "Please provide valid booking dates.",
        });
      }

      const renterEmail = req.user?.email?.toLowerCase();

      if (!renterEmail) {
        return res.status(401).json({
          success: false,
          message: "User authentication required.",
        });
      }

      const db = getDB();
      const equipmentObjectId = new ObjectId(equipmentId);

      const equipment = await db.collection<Equipment>("equipment").findOne({
        _id: equipmentObjectId,
        status: "approved",
      });

      if (!equipment) {
        return res.status(404).json({
          success: false,
          message: "Equipment not found or not available.",
        });
      }

      if (equipment.ownerEmail.toLowerCase() === renterEmail) {
        return res.status(400).json({
          success: false,
          message: "You cannot book your own equipment.",
        });
      }

      const now = new Date();

      // Prevent overlapping paid bookings and active 15-minute payment holds.
      const existingBooking = await db.collection<Rental>("rentals").findOne({
        equipmentId: equipmentObjectId,
        startDate: { $lt: rentalEnd },
        endDate: { $gt: rentalStart },
        $or: [
          { paymentStatus: "paid" },
          {
            paymentStatus: "unpaid",
            expiresAt: { $gt: now },
          },
        ],
      });

      if (existingBooking) {
        return res.status(409).json({
          success: false,
          message: "This equipment is already reserved for these dates.",
        });
      }

      if (
        !Number.isFinite(equipment.pricePerDay) ||
        equipment.pricePerDay <= 0
      ) {
        return res.status(400).json({
          success: false,
          message: "Equipment rental price is invalid.",
        });
      }

      const totalDays = Math.ceil(
        (rentalEnd.getTime() - rentalStart.getTime()) /
          (1000 * 60 * 60 * 24),
      );

      const totalPrice = totalDays * equipment.pricePerDay;

      if (!Number.isSafeInteger(Math.round(totalPrice * 100))) {
        return res.status(400).json({
          success: false,
          message: "Booking amount is invalid.",
        });
      }

      const newRental: Rental = {
        equipmentId: equipmentObjectId,
        renterEmail,
        ownerEmail: equipment.ownerEmail.toLowerCase(),
        startDate: rentalStart,
        endDate: rentalEnd,
        totalDays,
        totalPrice,
        paymentStatus: "unpaid",
        expiresAt: new Date(now.getTime() + 15 * 60 * 1000),
        createdAt: now,
        updatedAt: now,
      };

      const result = await db.collection<Rental>("rentals").insertOne(newRental);

      return res.status(201).json({
        success: true,
        message: "Booking created. Complete payment within 15 minutes.",
        data: {
          _id: result.insertedId,
          ...newRental,
        },
      });
    } catch (error) {
      console.error("Create booking error:", error);

      return res.status(500).json({
        success: false,
        message: "Failed to create booking.",
      });
    }
  },
);

// Get My Bookings (Renter Only)
router.get(
  "/my",
  verifyRenter,
  async (req: Request, res: Response) => {
    try {
      const renterEmail = req.user?.email?.toLowerCase();

      if (!renterEmail) {
        return res.status(401).json({
          success: false,
          message: "User authentication required.",
        });
      }

      const db = getDB();

      const bookings = await db
        .collection<Rental>("rentals")
        .aggregate([
          {
            $match: { renterEmail },
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
            $sort: { createdAt: -1 },
          },
        ])
        .toArray();

      return res.status(200).json({
        success: true,
        message: "My bookings fetched successfully.",
        data: bookings,
      });
    } catch (error) {
      console.error("Get my bookings error:", error);

      return res.status(500).json({
        success: false,
        message: "Failed to fetch bookings.",
      });
    }
  },
);

// Get My Equipment's Paid Bookings (Owner Only)
router.get(
  "/owner",
  verifyOwner,
  async (req: Request, res: Response) => {
    try {
      const ownerEmail = req.user?.email?.toLowerCase();

      if (!ownerEmail) {
        return res.status(401).json({
          success: false,
          message: "User authentication required.",
        });
      }

      const db = getDB();

      const bookings = await db
        .collection<Rental>("rentals")
        .aggregate([
          {
            $match: {
              ownerEmail,
              paymentStatus: "paid",
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
            $sort: { createdAt: -1 },
          },
        ])
        .toArray();

      return res.status(200).json({
        success: true,
        message: "Your paid equipment bookings fetched successfully.",
        data: bookings,
      });
    } catch (error) {
      console.error("Get owner bookings error:", error);

      return res.status(500).json({
        success: false,
        message: "Failed to fetch owner bookings.",
      });
    }
  },
);

export default router;
