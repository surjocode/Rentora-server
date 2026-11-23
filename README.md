# Rentora – Equipment Rental Platform (Backend)

Rentora is an Equipment Rental Platform that allows users to rent equipment and owners to manage their equipment listings. This repository contains the backend REST API built with Node.js, Express.js, TypeScript, and MongoDB.

## 🚀 Technologies Used

- Node.js
- Express.js
- TypeScript
- MongoDB
- Better Auth
- JSON Web Token (JWT)
- Stripe Checkout
- Stripe Webhooks
- CORS
- dotenv

## ✨ Key Features

- RESTful API architecture
- User authentication and authorization
- Role-Based Access Control (RBAC)
- Equipment listing management
- Equipment search, filtering, and sorting
- Equipment approval and moderation
- Equipment favorites management
- Rental booking management
- Booking date and availability validation
- Secure Stripe Checkout integration
- Stripe webhook payment verification
- Automatic booking confirmation after successful payment
- Payment record management
- Protected API endpoints

## 📁 Project Structure

```text
Rentora-server/
├── src/
│   ├── middleware/
│   ├── routes/
│   ├── types/
│   └── server.ts
├── .env
├── .gitignore
├── package.json
├── package-lock.json
└── tsconfig.json
```

## ⚙️ Installation and Setup

### 1. Clone the repository

```bash
https://github.com/surjocode/Rentora-server
```

### 2. Navigate to the project directory

```bash
cd rentora-server
```

### 3. Install dependencies

```bash
npm install
```

### 4. Configure environment variables

Create a `.env` file in the root directory and configure the following variables:

```env
PORT=5000
MONGODB_URI=your_mongodb_connection_string
BETTER_AUTH_URL=your_better_auth_url
CLIENT_URL=http://localhost:3000
STRIPE_SECRET_KEY=your_stripe_secret_key
STRIPE_WEBHOOK_SECRET=your_stripe_webhook_secret
USD_TO_BDT_RATE=125
```

**Important:** Never commit your `.env` file or expose secret keys publicly.

### 5. Run the development server

```bash
npm run dev
```

The backend server will run at:

```text
http://localhost:5000
```

## 💳 Payment Integration

Rentora uses Stripe Hosted Checkout for secure rental payments.

Payment workflow:

1. Customer creates a rental booking.
2. Backend creates a booking with `pending_payment` status.
3. Backend creates a Stripe Checkout Session.
4. Customer completes payment through Stripe Checkout.
5. Stripe sends a `checkout.session.completed` event.
6. Backend verifies the webhook signature and payment information.
7. Booking status changes to `confirmed`.
8. Payment status changes to `paid`.

### Booking Status

- `pending_payment`
- `confirmed`
- `completed`
- `cancelled`

### Payment Status

- `pending`
- `paid`
- `failed`
- `refunded`

## 📡 API Base URL

Local development:

```text
http://localhost:5000
```

API endpoints are organized into route modules for equipment, categories, favorites, users, admin, uploads, rentals, and payments.

## 🔐 Security

- Protected routes using JWT verification
- Role-based access control
- Secure environment variable configuration
- Stripe webhook signature verification
- Server-side payment amount calculation
- Booking ownership validation

## 👨‍💻 Author

**Piel Mitra**

- GitHub: https://github.com/surjocode

---

**Rentora – Making Equipment Rental Simple and Accessible.**
