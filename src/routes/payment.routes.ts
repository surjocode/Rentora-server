
import express, { Router, type Request, type Response } from "express";
import { ObjectId } from "mongodb";

import { getDB } from "../server.js";
import { verifyToken, verifyRenter } from "../middleware/auth.middleware.js";
import stripe from "../config/stripe.js";

const router = Router();

interface RentalDocument {
  _id: ObjectId;
  equipmentId: ObjectId;
  renterEmail: string;
  ownerEmail: string;
  totalPrice: number;
  paymentStatus: "unpaid" | "paid";
  stripePaymentIntentId?: string;
  updatedAt?: Date;
}

interface EquipmentDocument {
  _id: ObjectId;
  name: string;
}

// Create Stripe PaymentIntent
router.post(
  "/create-payment-intent",
  express.json(),
  verifyToken,
  verifyRenter,
  async (req: Request, res: Response) => {
    try {
      const { rentalId } = req.body as { rentalId?: string };
      const renterEmail = req.user?.email?.toLowerCase();

      if (!rentalId || !ObjectId.isValid(rentalId)) {
        return res.status(400).json({
          success: false,
          message: "Valid rental ID is required.",
        });
      }

      if (!renterEmail) {
        return res.status(401).json({
          success: false,
          message: "User email not found.",
        });
      }

      const db = getDB();

      const rental = await db.collection<RentalDocument>("rentals").findOne({
        _id: new ObjectId(rentalId),
        renterEmail,
      });

      if (!rental) {
        return res.status(404).json({
          success: false,
          message: "Rental not found.",
        });
      }

      // Already paid?
      if (rental.paymentStatus === "paid") {
        return res.status(400).json({
          success: false,
          message: "This rental has already been paid.",
        });
      }

      if (
        !Number.isFinite(rental.totalPrice) ||
        rental.totalPrice <= 0
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid rental payment amount.",
        });
      }

      const equipment = await db
        .collection<EquipmentDocument>("equipment")
        .findOne({ _id: rental.equipmentId });

      if (!equipment) {
        return res.status(404).json({
          success: false,
          message: "Equipment not found.",
        });
      }

      // Convert BDT to paisa.
      const amountInPaisa = Math.round(rental.totalPrice * 100);

      if (!Number.isSafeInteger(amountInPaisa) || amountInPaisa <= 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid payment amount.",
        });
      }

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
          rentalId: rental._id.toString(),
          renterEmail,
        },
      });

      await db.collection<RentalDocument>("rentals").updateOne(
        {
          _id: rental._id,
          renterEmail,
          paymentStatus: "unpaid",
        },
        {
          $set: {
            stripePaymentIntentId: paymentIntent.id,
            updatedAt: new Date(),
          },
        }
      );

      return res.status(200).json({
        success: true,
        message: "Payment intent created successfully.",
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

// Stripe Webhook
router.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req: Request, res: Response) => {
    const signature = req.headers["stripe-signature"];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!signature || !webhookSecret) {
      return res.status(400).send("Missing Stripe webhook signature or secret.");
    }

    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body as Buffer,
        signature,
        webhookSecret
      );
    } catch (error) {
      console.error("Webhook signature verification failed:", error);
      return res.status(400).send("Invalid webhook signature.");
    }

    try {
      if (event.type === "payment_intent.succeeded") {
        const paymentIntent = event.data.object;

        const rentalId = paymentIntent.metadata.rentalId;
        const renterEmail = paymentIntent.metadata.renterEmail?.toLowerCase();

        if (
          !rentalId ||
          !ObjectId.isValid(rentalId) ||
          !renterEmail ||
          paymentIntent.currency !== "bdt"
        ) {
          return res.status(400).send("Invalid payment metadata.");
        }

        const db = getDB();

        const rental = await db.collection<RentalDocument>("rentals").findOne({
          _id: new ObjectId(rentalId),
          renterEmail,
          stripePaymentIntentId: paymentIntent.id,
        });

        if (!rental) {
          return res.status(200).json({
            received: true,
            message: "Rental not found or payment intent does not match.",
          });
        }

        const expectedAmount = Math.round(rental.totalPrice * 100);

        if (paymentIntent.amount_received !== expectedAmount) {
          console.error("Stripe payment amount mismatch:", {
            expectedAmount,
            receivedAmount: paymentIntent.amount_received,
          });

          return res.status(400).send("Payment amount mismatch.");
        }

        // Mark rental as paid.
        await db.collection<RentalDocument>("rentals").updateOne(
          {
            _id: rental._id,
            renterEmail,
            stripePaymentIntentId: paymentIntent.id,
            paymentStatus: "unpaid",
          },
          {
            $set: {
              paymentStatus: "paid",
              updatedAt: new Date(),
            },
          }
        );

        // Save payment record. Upsert makes webhook retries safer.
        await db.collection("payments").updateOne(
          { stripePaymentIntentId: paymentIntent.id },
          {
            $setOnInsert: {
              rentalId: rental._id,
              renterEmail,
              stripePaymentIntentId: paymentIntent.id,
              amount: paymentIntent.amount_received,
              currency: paymentIntent.currency,
              status: "paid",
              createdAt: new Date(),
            },
          },
          { upsert: true }
        );
      }

      return res.status(200).json({ received: true });
    } catch (error) {
      console.error("Stripe Webhook Processing Error:", error);
      return res.status(500).send("Webhook processing failed.");
    }
  }
);

export default router;
