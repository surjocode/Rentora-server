
import express, { Router, type Request, type Response } from "express";
import { ObjectId } from "mongodb";

import { getDB, getMongoClient } from "../server.js";
import { verifyToken, verifyRenter } from "../middleware/auth.middleware.js";
import stripe, {
  getStripeWebhookSecret,
} from "../config/stripe.js";

const router = Router();

interface EquipmentDocument {
  _id: ObjectId;
  name: string;
  pricePerDay: number;
  availableQuantity: number;
  ownerEmail: string;
  status: string;
  bookingVersion?: number;
}

interface RentalDocument {
  _id: ObjectId;
  equipmentId: ObjectId;
  renterEmail: string;
  ownerEmail: string;
  startDate: Date;
  endDate: Date;
  totalDays: number;
  quantity: number;
  totalPrice: number;
  paymentStatus: "paid";
  stripePaymentIntentId: string;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================
// CREATE PAYMENT INTENT
// No booking is created before successful payment.
// ============================================

router.post(
  "/create-payment-intent",
  express.json(),
  verifyToken,
  verifyRenter,
  async (req: Request, res: Response) => {
    try {
      const { equipmentId, startDate, endDate, quantity } = req.body as {
        equipmentId?: string;
        startDate?: string;
        endDate?: string;
        quantity?: number;
      };

      const renterEmail = req.user?.email?.toLowerCase();

      if (!renterEmail) {
        return res.status(401).json({
          success: false,
          message: "User email not found.",
        });
      }

      if (
        !equipmentId ||
        !ObjectId.isValid(equipmentId) ||
        typeof startDate !== "string" ||
        typeof endDate !== "string" ||
        !Number.isSafeInteger(quantity) ||
        !quantity ||
        quantity <= 0
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid booking information.",
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
          message: "Please provide valid rental dates.",
        });
      }

      const db = getDB();
      const equipmentObjectId = new ObjectId(equipmentId);

      const equipment = await db
        .collection<EquipmentDocument>("equipment")
        .findOne({
          _id: equipmentObjectId,
          status: "approved",
        });

      if (!equipment) {
        return res.status(404).json({
          success: false,
          message: "Equipment not found or unavailable.",
        });
      }

      if (equipment.ownerEmail.toLowerCase() === renterEmail) {
        return res.status(400).json({
          success: false,
          message: "You cannot rent your own equipment.",
        });
      }

      if (
        !Number.isSafeInteger(equipment.availableQuantity) ||
        equipment.availableQuantity <= 0 ||
        !Number.isFinite(equipment.pricePerDay) ||
        equipment.pricePerDay <= 0
      ) {
        return res.status(400).json({
          success: false,
          message: "Equipment price or quantity is invalid.",
        });
      }

      const totalDays = Math.ceil(
        (rentalEnd.getTime() - rentalStart.getTime()) /
          (1000 * 60 * 60 * 24)
      );

      const totalPrice =
        totalDays * equipment.pricePerDay * quantity;

      const amountInPaisa = Math.round(totalPrice * 100);

      if (
        !Number.isFinite(totalPrice) ||
        !Number.isSafeInteger(amountInPaisa) ||
        amountInPaisa <= 0
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid payment amount.",
        });
      }

      // Preliminary availability check.
      // Final availability is checked again in the webhook.
      const overlappingBookings = await db
        .collection<RentalDocument>("rentals")
        .aggregate<{ totalQuantity: number }>([
          {
            $match: {
              equipmentId: equipmentObjectId,
              paymentStatus: "paid",
              startDate: { $lt: rentalEnd },
              endDate: { $gt: rentalStart },
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
        ])
        .toArray();

      const bookedQuantity =
        overlappingBookings[0]?.totalQuantity ?? 0;

      const remainingQuantity =
        equipment.availableQuantity - bookedQuantity;

      if (quantity > remainingQuantity) {
        return res.status(409).json({
          success: false,
          message: `Only ${Math.max(0, remainingQuantity)} unit(s) are available.`,
        });
      }

      // Create Stripe PaymentIntent.
      // No rental document is created at this stage.
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amountInPaisa,
        currency: "bdt",
        automatic_payment_methods: {
          enabled: true,
          allow_redirects: "never",
        },
        receipt_email: renterEmail,
        description: `Rentora - ${equipment.name}`,
        metadata: {
          equipmentId: equipmentObjectId.toString(),
          renterEmail,
          ownerEmail: equipment.ownerEmail.toLowerCase(),
          startDate: rentalStart.toISOString(),
          endDate: rentalEnd.toISOString(),
          totalDays: String(totalDays),
          quantity: String(quantity),
          totalPrice: String(totalPrice),
          pricePerDay: String(equipment.pricePerDay),
        },
      });

      return res.status(200).json({
        success: true,
        message: "Payment initialized successfully.",
        clientSecret: paymentIntent.client_secret,
      });
    } catch (error) {
      console.error("Stripe PaymentIntent Error:", error);

      return res.status(500).json({
        success: false,
        message: "Failed to initialize payment.",
      });
    }
  }
);

// ============================================
// STRIPE WEBHOOK
// Raw request body is required for verification.
// ============================================

router.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req: Request, res: Response) => {
    const signature = req.headers["stripe-signature"];

    if (!signature) {
      return res.status(400).send("Missing Stripe webhook signature.");
    }

    const webhookSecret = getStripeWebhookSecret();

    let event: import("stripe").Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body as Buffer,
        signature,
        webhookSecret
      );
    } catch (error) {
      console.error(
        "Webhook signature verification failed:",
        error
      );

      return res.status(400).send("Invalid Stripe signature.");
    }

    try {
      // Ignore events other than successful payments.
      if (event.type !== "payment_intent.succeeded") {
        return res.status(200).json({
          received: true,
        });
      }

      const paymentIntent =
        event.data.object as import("stripe").Stripe.PaymentIntent;

      const metadata = paymentIntent.metadata;

      const {
        equipmentId,
        renterEmail,
        ownerEmail,
        startDate,
        endDate,
        totalDays: totalDaysText,
        quantity: quantityText,
        totalPrice: totalPriceText,
      } = metadata;

      if (
        !equipmentId ||
        !ObjectId.isValid(equipmentId) ||
        !renterEmail ||
        !ownerEmail ||
        !startDate ||
        !endDate ||
        paymentIntent.currency !== "bdt"
      ) {
        return res.status(400).send("Invalid payment metadata.");
      }

      const rentalStart = new Date(startDate);
      const rentalEnd = new Date(endDate);

      const totalDays = Number(totalDaysText);
      const quantity = Number(quantityText);
      const totalPrice = Number(totalPriceText);

      if (
        Number.isNaN(rentalStart.getTime()) ||
        Number.isNaN(rentalEnd.getTime()) ||
        rentalEnd <= rentalStart ||
        !Number.isSafeInteger(totalDays) ||
        totalDays <= 0 ||
        !Number.isSafeInteger(quantity) ||
        quantity <= 0 ||
        !Number.isFinite(totalPrice) ||
        totalPrice <= 0 ||
        paymentIntent.amount_received !== Math.round(totalPrice * 100)
      ) {
        return res.status(400).send(
          "Invalid booking or payment amount."
        );
      }

      const db = getDB();
      const client = getMongoClient();

      const equipmentObjectId = new ObjectId(equipmentId);

      // Idempotency check.
      // Do not create duplicate bookings for webhook retries.
      const existingRental = await db
        .collection<RentalDocument>("rentals")
        .findOne({
          stripePaymentIntentId: paymentIntent.id,
        });

      if (existingRental) {
        return res.status(200).json({
          received: true,
          message: "Booking already created.",
        });
      }

      const session = client.startSession();

      let bookingCreated = false;
      let stockAvailable = false;

      try {
        await session.withTransaction(
          async () => {
            bookingCreated = false;
            stockAvailable = false;

            const equipment = await db
              .collection<EquipmentDocument>("equipment")
              .findOne(
                {
                  _id: equipmentObjectId,
                  status: "approved",
                },
                { session }
              );

            if (
              !equipment ||
              equipment.ownerEmail.toLowerCase() !==
                ownerEmail.toLowerCase()
            ) {
              return;
            }

            const overlappingBookings = await db
              .collection<RentalDocument>("rentals")
              .aggregate<{ totalQuantity: number }>(
                [
                  {
                    $match: {
                      equipmentId: equipmentObjectId,
                      paymentStatus: "paid",
                      startDate: { $lt: rentalEnd },
                      endDate: { $gt: rentalStart },
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

            if (
              quantity >
              equipment.availableQuantity - bookedQuantity
            ) {
              return;
            }

            stockAvailable = true;

            // Serialize concurrent bookings for the same equipment.
            const lockResult = await db
              .collection<EquipmentDocument>("equipment")
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
                "Equipment changed during payment confirmation."
              );
            }

            const now = new Date();

            const rental: RentalDocument = {
              _id: new ObjectId(),
              equipmentId: equipmentObjectId,
              renterEmail: renterEmail.toLowerCase(),
              ownerEmail: ownerEmail.toLowerCase(),
              startDate: rentalStart,
              endDate: rentalEnd,
              totalDays,
              quantity,
              totalPrice,
              paymentStatus: "paid",
              stripePaymentIntentId: paymentIntent.id,
              createdAt: now,
              updatedAt: now,
            };

            await db
              .collection<RentalDocument>("rentals")
              .insertOne(rental, { session });

            await db.collection("payments").updateOne(
              {
                stripePaymentIntentId: paymentIntent.id,
              },
              {
                $setOnInsert: {
                  rentalId: rental._id,
                  renterEmail: renterEmail.toLowerCase(),
                  stripePaymentIntentId: paymentIntent.id,
                  amount: paymentIntent.amount_received,
                  currency: paymentIntent.currency,
                  status: "paid",
                  createdAt: now,
                },
              },
              {
                upsert: true,
                session,
              }
            );

            bookingCreated = true;
          },
          {
            readConcern: {
              level: "snapshot",
            },
            writeConcern: {
              w: "majority",
            },
            readPreference: "primary",
          }
        );
      } finally {
        await session.endSession();
      }

      if (bookingCreated) {
        return res.status(200).json({
          received: true,
          message: "Payment successful and booking confirmed.",
        });
      }

      // Payment succeeded but equipment is no longer available.
      // Refund the customer instead of creating an invalid booking.
      const refund = await stripe.refunds.create(
        {
          payment_intent: paymentIntent.id,
        },
        {
          idempotencyKey:
            `rentora-unavailable-refund-${paymentIntent.id}`,
        }
      );

      await db.collection("payments").updateOne(
        {
          stripePaymentIntentId: paymentIntent.id,
        },
        {
          $setOnInsert: {
            renterEmail: renterEmail.toLowerCase(),
            stripePaymentIntentId: paymentIntent.id,
            amount: paymentIntent.amount_received,
            currency: paymentIntent.currency,
            status: "refunded",
            refundId: refund.id,
            createdAt: new Date(),
          },
        },
        {
          upsert: true,
        }
      );

      return res.status(200).json({
        received: true,
        message: stockAvailable
          ? "Payment refunded because booking could not be confirmed."
          : "Payment refunded because equipment is unavailable.",
      });
    } catch (error) {
      console.error("Stripe Webhook Processing Error:", error);

      return res.status(500).send(
        "Webhook processing failed."
      );
    }
  }
);

export default router;
