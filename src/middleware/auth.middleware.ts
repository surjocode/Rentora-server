
import type {
  Request,
  Response,
  NextFunction,
  RequestHandler,
} from "express";

import { createRemoteJWKSet, jwtVerify } from "jose";

let JWKS: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJWKS() {
  const BETTER_AUTH_URL = process.env.BETTER_AUTH_URL;

  if (!BETTER_AUTH_URL) {
    throw new Error("BETTER_AUTH_URL is missing from .env file");
  }

  if (!JWKS) {
    JWKS = createRemoteJWKSet(
      new URL(`${BETTER_AUTH_URL}/api/auth/jwks`)
    );
  }

  return JWKS;
}

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

    const { payload } = await jwtVerify(token, getJWKS());

    if (typeof payload.email !== "string") {
      res.status(401).json({
        success: false,
        message: "Invalid token payload.",
      });
      return;
    }

    if (
      payload.role !== "renter" &&
      payload.role !== "owner" &&
      payload.role !== "admin"
    ) {
      res.status(403).json({
        success: false,
        message: "Invalid user role.",
      });
      return;
    }

    req.user = {
      email: payload.email,
      role: payload.role,
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

export const verifyRenter: RequestHandler = (req, res, next) => {
  if (req.user?.role !== "renter") {
    res.status(403).json({
      success: false,
      message: "Access denied. Renter permission required.",
    });
    return;
  }

  next();
};

export const verifyOwner: RequestHandler = (req, res, next) => {
  if (req.user?.role !== "owner") {
    res.status(403).json({
      success: false,
      message: "Access denied. Owner permission required.",
    });
    return;
  }

  next();
};

export const verifyAdmin: RequestHandler = (req, res, next) => {
  if (req.user?.role !== "admin") {
    res.status(403).json({
      success: false,
      message: "Access denied. Admin permission required.",
    });
    return;
  }

  next();
};
