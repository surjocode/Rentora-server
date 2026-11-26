
import type {
  Request,
  Response,
  NextFunction,
  RequestHandler,
} from "express";

import { createRemoteJWKSet, jwtVerify } from "jose";

// ==========================================
// TYPES
// ==========================================

export type UserRole = "renter" | "owner" | "admin";

export interface AuthenticatedUser {
  email: string;
  role: UserRole;
}

// Extend Express Request
declare module "express-serve-static-core" {
  interface Request {
    user?: AuthenticatedUser;
  }
}

// ==========================================
// JWKS CONFIGURATION
// ==========================================

let JWKS: ReturnType<typeof createRemoteJWKSet> | null = null;

function getAuthConfig() {
  const baseURL = process.env.BETTER_AUTH_URL

  if (!baseURL) {
    throw new Error("BETTER_AUTH_URL is missing from backend .env");
  }

  if (!JWKS) {
    JWKS = createRemoteJWKSet(
      new URL(`${baseURL}/api/auth/jwks`)
    );
  }

  return {
    baseURL,
    JWKS,
  };
}

// ==========================================
// ROLE VALIDATION
// ==========================================

const isUserRole = (role: unknown): role is UserRole =>
  role === "renter" || role === "owner" || role === "admin";

// ==========================================
// VERIFY JWT TOKEN
// ==========================================

export const verifyToken: RequestHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authorization = req.headers.authorization;
    console.log( req.headers.authorization);

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

    const { JWKS } = getAuthConfig();

    const { payload } = await jwtVerify(token, JWKS
      
    );

    // Validate token payload
    const email = payload.email;
    const role = payload.role;

    if (typeof email !== "string" || !email.trim()) {
      res.status(401).json({
        success: false,
        message: "Invalid token email.",
      });

      return;
    }

    if (!isUserRole(role)) {
      res.status(403).json({
        success: false,
        message: "Invalid user role.",
      });

      return;
    }

    // Attach authenticated user to request
    req.user = {
      email: email.trim().toLowerCase(),
      role,
    };

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

// ==========================================
// RENTER AUTHORIZATION
// ==========================================

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

// ==========================================
// OWNER AUTHORIZATION
// ==========================================

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

// ==========================================
// ADMIN AUTHORIZATION
// ==========================================

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
