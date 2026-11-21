
import { Router, type Request, type Response } from "express";
import { ObjectId } from "mongodb";

import { getDB, getMongoClient } from "../server.js";
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
  quantity: number;
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
  availableQuantity: number;
  ownerEmail: string;
  status: string;
  bookingVersion?: number;
}

interface BookingResponse {
  statusCode: number;
  body: {
    success: boolean;
    message: string;
    data?: unknown;
  };
}

router.use(verifyToken);

// Create Booking (Renter Only)
router.post(
  "/",
  verifyRenter,
  async (req: Request, res: Response) => {
    try {
      const { equipmentId, startDate, endDate, quantity } = req.body as {
        equipmentId?: string;
        startDate?: string;
        endDate?: string;
        quantity?: number;
      };

      // Validate required information
      if (
        typeof equipmentId !== "string" ||
        typeof startDate !== "string" ||
        typeof endDate !== "string" ||
        quantity === undefined
      ) {
        return res.status(400).json({
          success: false,
          message: "Please provide equipment, dates and quantity.",
        });
      }

      // Validate equipment ID
      if (!ObjectId.isValid(equipmentId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid equipment ID.",
        });
      }

      // Validate quantity
      const requestedQuantity = Number(quantity);

      if (
        !Number.isSafeInteger(requestedQuantity) ||
        requestedQuantity <= 0
      ) {
        return res.status(400).json({
          success: false,
          message: "Quantity must be a positive integer.",
        });
      }

      // Validate dates
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
      const client = getMongoClient();
      const equipmentObjectId = new ObjectId(equipmentId);

      const session = client.startSession();

      const response: { current: BookingResponse | null } = {
        current: null,
      };

      try {
        await session.withTransaction(
          async () => {
            const now = new Date();

            // Reset response if MongoDB retries the transaction
            response.current = null;

            // Find approved equipment
            const equipment = await db
              .collection<Equipment>("equipment")
              .findOne(
                {
                  _id: equipmentObjectId,
                  status: "approved",
                },
                { session }
              );

            if (!equipment) {
              response.current = {
                statusCode: 404,
                body: {
                  success: false,
                  message: "Equipment not found or not available.",
                },
              };

              return;
            }

            // Prevent owner from booking own equipment
            if (equipment.ownerEmail.toLowerCase() === renterEmail) {
              response.current = {
                statusCode: 400,
                body: {
                  success: false,
                  message: "You cannot book your own equipment.",
                },
              };

              return;
            }

            // Validate equipment quantity
            if (
              !Number.isSafeInteger(equipment.availableQuantity) ||
              equipment.availableQuantity <= 0
            ) {
              response.current = {
                statusCode: 400,
                body: {
                  success: false,
                  message: "Equipment quantity is invalid or unavailable.",
                },
              };

              return;
            }

            // Validate equipment price
            if (
              !Number.isFinite(equipment.pricePerDay) ||
              equipment.pricePerDay <= 0
            ) {
              response.current = {
                statusCode: 400,
                body: {
                  success: false,
                  message: "Equipment rental price is invalid.",
                },
              };

              return;
            }

            // Find overlapping paid bookings and active unpaid holds
            const overlappingBookings = await db
              .collection<Rental>("rentals")
              .aggregate<{ totalQuantity: number }>(
                [
                  {
                    $match: {
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
                    },
                  },
                  {
                    $group: {
                      _id: null,
                      totalQuantity: {
                        $sum: {
                          $ifNull: ["$quantity", 1],
                        },
                      },
                    },
                  },
                ],
                { session }
              )
              .toArray();

            const bookedQuantity =
              overlappingBookings[0]?.totalQuantity ?? 0;

            const availableQuantity =
              equipment.availableQuantity - bookedQuantity;

            // Check requested quantity against availability
            if (requestedQuantity > availableQuantity) {
              response.current = {
                statusCode: 409,
                body: {
                  success: false,
                  message: `Only ${Math.max(
                    0,
                    availableQuantity
                  )} unit(s) are available for these dates.`,
                },
              };

              return;
            }

            // Calculate rental duration
            const totalDays = Math.ceil(
              (rentalEnd.getTime() - rentalStart.getTime()) /
                (1000 * 60 * 60 * 24)
            );

            // Calculate total price including quantity
            const totalPrice =
              totalDays *
              equipment.pricePerDay *
              requestedQuantity;

            if (
              !Number.isFinite(totalPrice) ||
              !Number.isSafeInteger(Math.round(totalPrice * 100))
            ) {
              response.current = {
                statusCode: 400,
                body: {
                  success: false,
                  message: "Booking amount is invalid.",
                },
              };

              return;
            }

            // Create a write conflict on the equipment document.
            // This helps prevent concurrent bookings from overselling inventory.
            const lockResult = await db
              .collection<Equipment>("equipment")
              .updateOne(
                {
                  _id: equipmentObjectId,
                  status: "approved",
                },
                {
                  $inc: {
                    bookingVersion: 1,
                  },
                },
                { session }
              );

            if (lockResult.matchedCount !== 1) {
              throw new Error(
                "Equipment changed during booking. Please try again."
              );
            }

            // Create unpaid booking with a 15-minute payment hold
            const newRental: Rental = {
              equipmentId: equipmentObjectId,
              renterEmail,
              ownerEmail: equipment.ownerEmail.toLowerCase(),
              startDate: rentalStart,
              endDate: rentalEnd,
              totalDays,
              quantity: requestedQuantity,
              totalPrice,
              paymentStatus: "unpaid",
              expiresAt: new Date(now.getTime() + 15 * 60 * 1000),
              createdAt: now,
              updatedAt: now,
            };

            const result = await db
              .collection<Rental>("rentals")
              .insertOne(newRental, { session });

            response.current = {
              statusCode: 201,
              body: {
                success: true,
                message:
                  "Booking created. Complete payment within 15 minutes.",
                data: {
                  _id: result.insertedId,
                  ...newRental,
                },
              },
            };
          },
          {
            readConcern: { level: "snapshot" },
            writeConcern: { w: "majority" },
            readPreference: "primary",
          }
        );
      } finally {
        await session.endSession();
      }

      if (!response.current) {
        return res.status(500).json({
          success: false,
          message: "Booking could not be completed.",
        });
      }

      return res
        .status(response.current.statusCode)
        .json(response.current.body);
    } catch (error) {
      console.error("Create booking error:", error);

      return res.status(500).json({
        success: false,
        message: "Failed to create booking. Please try again.",
      });
    }
  }
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
  }
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
  }
);

export default router;
