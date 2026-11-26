import { Router, type Request, type Response } from "express";
import { ObjectId } from "mongodb";

import { getDB } from "../server.js";
// import {
//   verifyToken,
//   verifyRenter,
//   verifyOwner,
//   verifyAdmin,
// } from "../middleware/auth.middleware.js";

const router = Router();

// ==========================================
// TYPES
// ==========================================

type RentalType = "daily" | "weekly" | "monthly";

type BookingStatus =
  | "pending_payment"
  | "confirmed"
  | "completed"
  | "cancelled";

type PaymentStatus =
  | "pending"
  | "paid"
  | "failed"
  | "refunded";

interface Equipment {
  name: string;
  rentalType: RentalType;
  pricePerDay: number;
  availableQuantity: number;
  ownerEmail: string;
  status: "pending" | "approved" | "rejected";
}

interface Booking {
  _id?: ObjectId;
  equipmentId: ObjectId;
  equipmentName: string;
  customerEmail: string;
  ownerEmail: string;

  startDate: Date;
  endDate: Date;

  rentalType: RentalType;
  rentalDays: number;
  periodCount: number;

  quantity: number;
  unitPrice: number;
  totalAmount: number;

  phone: string;
  address: string;
  notes: string;

  paymentStatus: PaymentStatus;
  bookingStatus: BookingStatus;

  createdAt: Date;
  updatedAt: Date;
}

// ==========================================
// HELPERS
// ==========================================

function sendError(
  res: Response,
  status: number,
  message: string
) {
  return res.status(status).json({
    success: false,
    message,
  });
}

function isValidObjectId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-fA-F]{24}$/.test(value)
  );
}

function parseDate(value: unknown): Date | null {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return null;
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    return null;
  }

  return date;
}

// Calculate rental duration in calendar days.
// End date is exclusive.
// Example: June 1 to June 4 = 3 rental days.
function getRentalDays(
  startDate: Date,
  endDate: Date
): number {
  const millisecondsPerDay = 24 * 60 * 60 * 1000;

  return Math.round(
    (endDate.getTime() - startDate.getTime()) /
      millisecondsPerDay
  );
}

// Calculate the number of billable rental periods.
function getPeriodCount(
  rentalType: RentalType,
  rentalDays: number
): number {
  switch (rentalType) {
    case "daily":
      return rentalDays;

    case "weekly":
      return Math.ceil(rentalDays / 7);

    case "monthly":
      return Math.ceil(rentalDays / 30);
  }
}

// ==========================================
// CREATE BOOKING
// CUSTOMER / RENTER ONLY
// ==========================================

router.post(
  "/",
  // verifyToken,
  // verifyRenter,
  async (req: Request, res: Response) => {
    try {
      const customerEmail = req.user?.email?.toLowerCase();

      if (!customerEmail) {
        return sendError(
          res,
          401,
          "User authentication required."
        );
      }

      const {
        equipmentId,
        startDate: startDateValue,
        endDate: endDateValue,
        quantity: quantityValue,
        phone,
        address,
        notes,
      } = req.body as Record<string, unknown>;

      // Validate equipment ID
      if (!isValidObjectId(equipmentId)) {
        return sendError(res, 400, "Invalid equipment ID.");
      }

      // Validate rental quantity
      const quantity = Number(quantityValue);

      if (
        !Number.isInteger(quantity) ||
        quantity <= 0
      ) {
        return sendError(
          res,
          400,
          "Quantity must be a positive integer."
        );
      }

      // Validate dates
      const startDate = parseDate(startDateValue);
      const endDate = parseDate(endDateValue);

      if (!startDate || !endDate) {
        return sendError(
          res,
          400,
          "Please provide valid start and end dates."
        );
      }

      if (startDate.getTime() < Date.now() - 24 * 60 * 60 * 1000) {
        return sendError(
          res,
          400,
          "Rental start date cannot be in the past."
        );
      }

      if (endDate.getTime() <= startDate.getTime()) {
        return sendError(
          res,
          400,
          "End date must be after start date."
        );
      }

      // Validate phone
      if (
        typeof phone !== "string" ||
        !/^\+?[0-9\s().-]{7,30}$/.test(phone.trim())
      ) {
        return sendError(
          res,
          400,
          "Please provide a valid contact phone number."
        );
      }

      // Validate delivery address
      if (
        typeof address !== "string" ||
        address.trim().length < 5 ||
        address.trim().length > 500
      ) {
        return sendError(
          res,
          400,
          "Please provide a valid delivery address."
        );
      }

      // Validate optional notes
      if (
        notes !== undefined &&
        (typeof notes !== "string" || notes.length > 1000)
      ) {
        return sendError(
          res,
          400,
          "Additional notes cannot exceed 1000 characters."
        );
      }

      const db = getDB();
      const equipmentObjectId = new ObjectId(equipmentId);

      // Find approved equipment
      const equipment = await db
        .collection<Equipment>("equipment")
        .findOne({
          _id: equipmentObjectId,
          status: "approved",
        });

      if (!equipment) {
        return sendError(
          res,
          404,
          "Approved equipment not found."
        );
      }

      // Prevent owners from booking their own equipment
      if (
        equipment.ownerEmail.toLowerCase() === customerEmail
      ) {
        return sendError(
          res,
          403,
          "You cannot book your own equipment."
        );
      }

      // Validate requested quantity
      if (quantity > equipment.availableQuantity) {
        return sendError(
          res,
          400,
          "Requested quantity exceeds available equipment quantity."
        );
      }

      // Calculate rental duration
      const rentalDays = getRentalDays(startDate, endDate);

      if (rentalDays <= 0) {
        return sendError(
          res,
          400,
          "Invalid rental duration."
        );
      }

      const periodCount = getPeriodCount(
        equipment.rentalType,
        rentalDays
      );

      // Calculate price on the backend only
      const unitPrice = equipment.pricePerDay;
      const totalAmount =
        unitPrice * periodCount * quantity;

      if (!Number.isSafeInteger(totalAmount)) {
        return sendError(
          res,
          400,
          "The calculated rental amount is invalid."
        );
      }

      // Check already confirmed bookings for overlapping dates.
      // Pending-payment bookings do not reserve stock yet.
      const overlappingBookings = await db
        .collection<Booking>("rentals")
        .find({
          equipmentId: equipmentObjectId,
          bookingStatus: "confirmed",
          startDate: { $lt: endDate },
          endDate: { $gt: startDate },
        })
        .toArray();

      const alreadyBookedQuantity =
        overlappingBookings.reduce(
          (total, booking) => total + booking.quantity,
          0
        );

      const remainingQuantity =
        equipment.availableQuantity - alreadyBookedQuantity;

      if (quantity > remainingQuantity) {
        return sendError(
          res,
          400,
          `Only ${Math.max(remainingQuantity, 0)} item(s) are available for these dates.`
        );
      }

      const now = new Date();

      const newBooking: Booking = {
        equipmentId: equipmentObjectId,
        equipmentName: equipment.name,

        customerEmail,
        ownerEmail: equipment.ownerEmail.toLowerCase(),

        startDate,
        endDate,

        rentalType: equipment.rentalType,
        rentalDays,
        periodCount,

        quantity,
        unitPrice,
        totalAmount,

        phone: phone.trim(),
        address: address.trim(),
        notes:
          typeof notes === "string" ? notes.trim() : "",

        paymentStatus: "pending",
        bookingStatus: "pending_payment",

        createdAt: now,
        updatedAt: now,
      };

      const result = await db
        .collection<Booking>("rentals")
        .insertOne(newBooking);

      return res.status(201).json({
        success: true,
        message:
          "Booking created. Payment is required to confirm your booking.",
        data: {
          _id: result.insertedId,
          ...newBooking,
        },
      });
    } catch (error) {
      console.error("Create booking error:", error);

      return sendError(
        res,
        500,
        "Failed to create booking."
      );
    }
  }
);

// ==========================================
// GET CUSTOMER'S BOOKINGS
// RENTER ONLY
// ==========================================

router.get(
  "/my",
  // verifyToken,
  // verifyRenter,
  async (req: Request, res: Response) => {
    try {
      const customerEmail = req.user?.email?.toLowerCase();

      if (!customerEmail) {
        return sendError(
          res,
          401,
          "User authentication required."
        );
      }

      const db = getDB();

      const bookings = await db
        .collection<Booking>("rentals")
        .find({ customerEmail })
        .sort({ createdAt: -1 })
        .toArray();

      return res.status(200).json({
        success: true,
        message: "Your rentals fetched successfully.",
        data: bookings,
      });
    } catch (error) {
      console.error("Get customer rentals error:", error);

      return sendError(
        res,
        500,
        "Failed to fetch your rentals."
      );
    }
  }
);

// ==========================================
// GET OWNER'S EQUIPMENT RENTALS
// OWNER ONLY
// ==========================================

router.get(
  "/owner",
  // verifyToken,
  // verifyOwner,
  async (req: Request, res: Response) => {
    try {
      const ownerEmail = req.user?.email?.toLowerCase();

      if (!ownerEmail) {
        return sendError(
          res,
          401,
          "User authentication required."
        );
      }

      const db = getDB();

      const bookings = await db
        .collection<Booking>("rentals")
        .find({ ownerEmail })
        .sort({ createdAt: -1 })
        .toArray();

      return res.status(200).json({
        success: true,
        message: "Equipment rentals fetched successfully.",
        data: bookings,
      });
    } catch (error) {
      console.error("Get owner rentals error:", error);

      return sendError(
        res,
        500,
        "Failed to fetch equipment rentals."
      );
    }
  }
);

// ==========================================
// GET ALL RENTALS
// ADMIN ONLY
// ==========================================

router.get(
  "/admin",
  // verifyToken,
  // verifyAdmin,
  async (_req: Request, res: Response) => {
    try {
      const db = getDB();

      const bookings = await db
        .collection<Booking>("rentals")
        .find({})
        .sort({ createdAt: -1 })
        .toArray();

      return res.status(200).json({
        success: true,
        message: "All rentals fetched successfully.",
        data: bookings,
      });
    } catch (error) {
      console.error("Get admin rentals error:", error);

      return sendError(
        res,
        500,
        "Failed to fetch all rentals."
      );
    }
  }
);

export default router;