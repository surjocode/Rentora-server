
import { Router, type Request, type Response } from "express";
import { ObjectId } from "mongodb";
import Stripe from "stripe";

import { getDB } from "../server.js";
import {
  verifyToken,
  verifyRenter,
} from "../middleware/auth.middleware.js";

const router = Router();

// ==========================================
// TYPES
// ==========================================

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

interface Booking {
  _id?: ObjectId;
  customerEmail: string;
  equipmentName: string;
  totalAmount: number;
  paymentStatus: PaymentStatus;
  bookingStatus: BookingStatus;
  stripeSessionId?: string;
  usdAmount?: number;
  exchangeRate?: number;
}

interface PaymentRecord {
  _id: string;
  stripeEventId: string;
  stripeSessionId: string;
  paymentIntentId: string | null;
  bookingId: ObjectId;
  customerEmail: string;
  bdtAmount: number;
  usdAmount: number;
  currency: string;
  paymentStatus: "paid";
  paidAt: Date;
  createdAt: Date;
}

// ==========================================
// STRIPE CONFIGURATION
// ==========================================

function getStripe(): Stripe {
  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY is missing from .env");
  }

  return new Stripe(secretKey);
}

// ==========================================
// ERROR HELPER
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

// ==========================================
// CREATE STRIPE CHECKOUT SESSION
// RENTER ONLY
// ==========================================

router.post(
  "/create-checkout-session",
  verifyToken,
  verifyRenter,
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

      const { bookingId } = req.body as {
        bookingId?: unknown;
      };

      if (
        typeof bookingId !== "string" ||
        !/^[0-9a-fA-F]{24}$/.test(bookingId)
      ) {
        return sendError(res, 400, "Invalid booking ID.");
      }

      const exchangeRate = Number(
        process.env.USD_TO_BDT_RATE
      );

      if (
        !Number.isFinite(exchangeRate) ||
        exchangeRate <= 0
      ) {
        return sendError(
          res,
          500,
          "A valid USD_TO_BDT_RATE is required."
        );
      }

      const clientURL = process.env.CLIENT_URL;

      if (!clientURL) {
        return sendError(
          res,
          500,
          "CLIENT_URL is missing from .env."
        );
      }

      const db = getDB();
      const rentalsCollection = db.collection<Booking>("rentals");

      const objectBookingId = new ObjectId(bookingId);

      // Find the renter's own booking
      const booking = await rentalsCollection.findOne({
        _id: objectBookingId,
        customerEmail,
      });

      if (!booking) {
        return sendError(res, 404, "Booking not found.");
      }

      // Only pending bookings can be paid
      if (
        booking.bookingStatus !== "pending_payment" ||
        booking.paymentStatus !== "pending"
      ) {
        return sendError(
          res,
          400,
          "This booking is not available for payment."
        );
      }

      if (
        !Number.isSafeInteger(booking.totalAmount) ||
        booking.totalAmount <= 0
      ) {
        return sendError(
          res,
          400,
          "Invalid booking amount."
        );
      }

      // Convert BDT to USD cents
      const usdAmount = Math.round(
        (booking.totalAmount / exchangeRate) * 100
      );

      if (!Number.isSafeInteger(usdAmount) || usdAmount < 50) {
        return sendError(
          res,
          400,
          "Payment amount is below the minimum Stripe charge."
        );
      }

      const stripe = getStripe();

      // Create Stripe Checkout Session
      const session = await stripe.checkout.sessions.create(
        {
          mode: "payment",
          customer_email: customerEmail,

          line_items: [
            {
              price_data: {
                currency: "usd",
                product_data: {
                  name: booking.equipmentName,
                  description: `Rentora equipment booking ${bookingId}`,
                },
                unit_amount: usdAmount,
              },
              quantity: 1,
            },
          ],

          metadata: {
            bookingId,
            customerEmail,
            bdtAmount: String(booking.totalAmount),
            usdAmount: String(usdAmount),
            exchangeRate: String(exchangeRate),
          },

          success_url: `${clientURL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,

          cancel_url: `${clientURL}/payment/cancel?booking_id=${bookingId}`,
        }
      );

      if (!session.url) {
        return sendError(
          res,
          500,
          "Unable to create Stripe Checkout URL."
        );
      }

      // Save Stripe session information
      const updateResult = await rentalsCollection.updateOne(
        {
          _id: objectBookingId,
          customerEmail,
          bookingStatus: "pending_payment",
          paymentStatus: "pending",
        },
        {
          $set: {
            stripeSessionId: session.id,
            usdAmount,
            exchangeRate,
            updatedAt: new Date(),
          },
        }
      );

      if (updateResult.matchedCount === 0) {
        return sendError(
          res,
          409,
          "Booking status changed. Please try again."
        );
      }

      return res.status(200).json({
        success: true,
        message: "Stripe Checkout Session created successfully.",
        data: {
          checkoutUrl: session.url,
          sessionId: session.id,
          bookingId,
          bdtAmount: booking.totalAmount,
          usdAmount,
          exchangeRate,
          currency: "USD",
        },
      });
    } catch (error) {
      console.error("Create Stripe Checkout error:", error);

      return sendError(
        res,
        500,
        "Failed to create Stripe Checkout Session."
      );
    }
  }
);

// ==========================================
// STRIPE WEBHOOK
// ==========================================

router.post(
  "/webhook",
  async (req: Request, res: Response) => {
    try {
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

      if (!webhookSecret) {
        console.error("STRIPE_WEBHOOK_SECRET is missing.");

        return sendError(
          res,
          500,
          "Stripe webhook configuration is missing."
        );
      }

      const signature = req.headers["stripe-signature"];

      if (!signature || Array.isArray(signature)) {
        return sendError(
          res,
          400,
          "Missing Stripe signature."
        );
      }

      if (!Buffer.isBuffer(req.body)) {
        return sendError(
          res,
          400,
          "Invalid webhook request body."
        );
      }

      const stripe = getStripe();

      let event: Stripe.Event;

      try {
        event = stripe.webhooks.constructEvent(
          req.body,
          signature,
          webhookSecret
        );
      } catch (error) {
        console.error(
          "Stripe signature verification failed:",
          error
        );

        return sendError(
          res,
          400,
          "Invalid Stripe webhook signature."
        );
      }

      // Ignore unrelated events
      if (event.type !== "checkout.session.completed") {
        return res.status(200).json({
          received: true,
          message: "Event received. No action required.",
        });
      }

      const session =
        event.data.object as Stripe.Checkout.Session;

      // Confirm payment is actually completed
      if (session.payment_status !== "paid") {
        return res.status(200).json({
          received: true,
          message: "Checkout session is not paid yet.",
        });
      }

      const bookingId = session.metadata?.bookingId;
      const customerEmail =
        session.metadata?.customerEmail?.toLowerCase();

      if (
        !bookingId ||
        !/^[0-9a-fA-F]{24}$/.test(bookingId) ||
        !customerEmail
      ) {
        return sendError(
          res,
          400,
          "Invalid booking information in Stripe session."
        );
      }

      if (
        session.currency !== "usd" ||
        !Number.isSafeInteger(session.amount_total) ||
        session.amount_total === null ||
        session.amount_total <= 0
      ) {
        return sendError(
          res,
          400,
          "Invalid Stripe payment amount or currency."
        );
      }

      const db = getDB();

      const rentalsCollection =
        db.collection<Booking>("rentals");

      const paymentsCollection =
        db.collection<PaymentRecord>("payments");

      const objectBookingId = new ObjectId(bookingId);

      // Find booking
      const booking = await rentalsCollection.findOne({
        _id: objectBookingId,
        customerEmail,
      });

      if (!booking) {
        return sendError(res, 404, "Booking not found.");
      }

      // Verify Checkout Session ownership
      if (booking.stripeSessionId !== session.id) {
        return sendError(
          res,
          400,
          "Stripe session does not match this booking."
        );
      }

      // Verify amount
      if (
        booking.usdAmount !== session.amount_total ||
        !Number.isSafeInteger(booking.totalAmount) ||
        booking.totalAmount <= 0
      ) {
        return sendError(
          res,
          400,
          "Payment amount does not match the booking."
        );
      }

      // Verify booking status
      if (
        booking.bookingStatus !== "pending_payment" ||
        booking.paymentStatus !== "pending"
      ) {
        // Allow webhook retries after successful confirmation
        if (
          booking.bookingStatus !== "confirmed" ||
          booking.paymentStatus !== "paid"
        ) {
          return sendError(
            res,
            400,
            "Booking is not eligible for payment confirmation."
          );
        }
      }

      const now = new Date();

      // Confirm booking after successful payment
      await rentalsCollection.updateOne(
        {
          _id: objectBookingId,
          customerEmail,
          stripeSessionId: session.id,
          bookingStatus: "pending_payment",
          paymentStatus: "pending",
        },
        {
          $set: {
            paymentStatus: "paid",
            bookingStatus: "confirmed",
            paidAt: now,
            updatedAt: now,
          },
        }
      );

      // Verify booking confirmation
      const confirmedBooking = await rentalsCollection.findOne({
        _id: objectBookingId,
        customerEmail,
        stripeSessionId: session.id,
        paymentStatus: "paid",
        bookingStatus: "confirmed",
      });

      if (!confirmedBooking) {
        throw new Error(
          "Booking could not be confirmed after successful payment."
        );
      }

      const paymentIntentId =
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent?.id ?? null;

      const paymentRecord: PaymentRecord = {
        _id: event.id,
        stripeEventId: event.id,
        stripeSessionId: session.id,
        paymentIntentId,
        bookingId: objectBookingId,
        customerEmail,
        bdtAmount: booking.totalAmount,
        usdAmount: session.amount_total,
        currency: session.currency,
        paymentStatus: "paid",
        paidAt: now,
        createdAt: now,
      };

      // Prevent duplicate records on webhook retries
      await paymentsCollection.updateOne(
        {
          _id: event.id,
        },
        {
          $setOnInsert: paymentRecord,
        },
        {
          upsert: true,
        }
      );

      console.log(
        `Payment confirmed successfully for booking: ${bookingId}`
      );

      return res.status(200).json({
        received: true,
        success: true,
        message: "Payment confirmed successfully.",
      });
    } catch (error) {
      console.error("Stripe webhook error:", error);

      return sendError(
        res,
        500,
        "Failed to process Stripe webhook."
      );
    }
  }
);

export default router;
