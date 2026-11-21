import dotenv from "dotenv";
import Stripe from "stripe";

// Load environment variables
dotenv.config({ override: true });

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

if (!stripeSecretKey) {
  throw new Error("STRIPE_SECRET_KEY is missing from .env");
}

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

if (!webhookSecret) {
  throw new Error("STRIPE_WEBHOOK_SECRET is missing from .env");
}

const stripe = new Stripe(stripeSecretKey);

export const getStripeWebhookSecret = (): string => {
  return webhookSecret;
};

export default stripe;