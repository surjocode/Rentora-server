
import type {
  Request,
  Response,
  NextFunction,
  RequestHandler,
} from "express";

import { createRemoteJWKSet, jwtVerify } from "jose";

type UserRole = "renter" | "owner" | "admin";

export interface AuthenticatedUser {
  email: string;
  role: UserRole;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

let JWKS: ReturnType<typeof createRemoteJWKSet> | null = null;

function getAuthConfig() {
  const baseURL = process.env.BETTER_AUTH_URL?.replace(/\/+$/, "");

  if (!baseURL) {
    throw new Error("BETTER_AUTH_URL is missing from backend .env");
  }

  if (!JWKS) {
    JWKS = createRemoteJWKSet(
      new URL(`${baseURL}/api/auth/jwks`)
    );
  }

  return { baseURL, JWKS };
}

// Verify JWT token
export const verifyToken: RequestHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const authorization = req.headers.authorization;

    if (!authorization?.startsWith("Bearer ")) {
      res.status(401).json({
        success: false,
        message: "Unauthorized. Token is required.",
      });
      return;
    }

    const token = authorization.slice(7).trim();

    if (!token) {
      res.status(401).json({
        success: false,
        message: "Invalid authorization token.",
      });
      return;
    }

    const { baseURL, JWKS } = getAuthConfig();

    const { payload } = await jwtVerify(token, JWKS, {
      issuer: baseURL,
      audience: baseURL,
    });

    const email = payload.email;
    const role = payload.role;

    if (typeof email !== "string") {
      res.status(401).json({
        success: false,
        message: "Invalid token email.",
      });
      return;
    }

    if (
      role !== "renter" &&
      role !== "owner" &&
      role !== "admin"
    ) {
      res.status(403).json({
        success: false,
        message: "Invalid user role.",
      });
      return;
    }

    req.user = {
      email,
      role,
    };

    console.log("JWT verified successfully:", {
      role: req.user.role,
    });

    next();
  } catch (error) {
    console.error(
      "JWT verification failed:",
      error instanceof Error ? error.message : "Unknown error"
    );

    res.status(401).json({
      success: false,
      message: "Invalid or expired token.",
    });
  }
};

// Renter permission
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

// Owner permission
export const verifyOwner: RequestHandler = (
  req,
  res,
  next
) => {
  console.log("Owner permission check:", {
    role: req.user?.role,
  });

  if (req.user?.role !== "owner") {
    res.status(403).json({
      success: false,
      message: "Access denied. Owner permission required.",
    });
    return;
  }

  next();
};

// Admin permission
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
