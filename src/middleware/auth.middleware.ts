
import type { Request, Response, NextFunction, RequestHandler } from "express";
import { createRemoteJWKSet, jwtVerify } from "jose";

const BETTER_AUTH_URL = process.env.BETTER_AUTH_URL;

if (!BETTER_AUTH_URL) {
  throw new Error("BETTER_AUTH_URL is missing from .env file");
}

const JWKS = createRemoteJWKSet(
  new URL(`${BETTER_AUTH_URL}/api/auth/jwks`)
);

export interface AuthenticatedUser {
  email: string;
  role: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

// Verify JWT Token
export const verifyToken: RequestHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const authorization = req.headers.authorization;

    if (!authorization || !authorization.startsWith("Bearer ")) {
      res.status(401).json({
        success: false,
        message: "Unauthorized. Token is required.",
      });
      return;
    }

    const token = authorization.split(" ")[1];

    if (!token) {
      res.status(401).json({
        success: false,
        message: "Invalid authorization token.",
      });
      return;
    }

    const { payload } = await jwtVerify(token, JWKS);

    if (typeof payload.email !== "string") {
      res.status(401).json({
        success: false,
        message: "Invalid token payload.",
      });
      return;
    }

    req.user = {
      email: payload.email,
      role: typeof payload.role === "string" ? payload.role : "renter",
    };

    next();
  } catch (error) {
    console.error("JWT verification error:", error);

    res.status(401).json({
      success: false,
      message: "Invalid or expired token.",
    });
  }
};

// Renter Role Middleware
export const verifyRenter: RequestHandler = (
  req,
  res,
  next
) => {
  if (req.user?.role !== "renter") {
    res.status(403).json({
      success: false,
      message: "Access denied. Renter permission required.",
    });
    return;
  }

  next();
};

// Owner Role Middleware
export const verifyOwner: RequestHandler = (
  req,
  res,
  next
) => {
  if (req.user?.role !== "owner") {
    res.status(403).json({
      success: false,
      message: "Access denied. Owner permission required.",
    });
    return;
  }

  next();
};

// Admin Role Middleware
export const verifyAdmin: RequestHandler = (
  req,
  res,
  next
) => {
  if (req.user?.role !== "admin") {
    res.status(403).json({
      success: false,
      message: "Access denied. Admin permission required.",
    });
    return;
  }

  next();
};
