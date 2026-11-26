
import { Router, type Request, type Response } from "express";
import { ObjectId, type Filter } from "mongodb";

import { getDB } from "../server.js";
// import {
//   verifyToken,
//   verifyOwner,
// } from "../middleware/auth.middleware.js";

const router = Router();

// ==========================================
// TYPES
// ==========================================

interface Equipment {
  name: string;
  description: string;
  category: string;
  rentalType: "daily" | "weekly" | "monthly";
  pricePerDay: number;
  availableQuantity: number;
  condition: string;
  brand: string;
  model: string;
  location: string;
  image: string;
  termsAndConditions: string;
  ownerEmail: string;
  status: "pending" | "approved" | "rejected";
  createdAt: Date;
  updatedAt: Date;
}

type RentalType = Equipment["rentalType"];

type SortOption =
  | "newest"
  | "oldest"
  | "price-asc"
  | "price-desc";

const RENTAL_TYPES: readonly RentalType[] = [
  "daily",
  "weekly",
  "monthly",
];

const SORT_OPTIONS: readonly SortOption[] = [
  "newest",
  "oldest",
  "price-asc",
  "price-desc",
];

// ==========================================
// HELPERS
// ==========================================

function isValidObjectId(id: unknown): id is string {
  return typeof id === "string" && ObjectId.isValid(id);
}

function isRentalType(value: unknown): value is RentalType {
  return (
    typeof value === "string" &&
    RENTAL_TYPES.includes(value as RentalType)
  );
}

function isSortOption(value: unknown): value is SortOption {
  return (
    typeof value === "string" &&
    SORT_OPTIONS.includes(value as SortOption)
  );
}

function getQueryString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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
// GET ALL APPROVED EQUIPMENT
// SEARCH, FILTER AND SORT
// ==========================================

router.get("/", async (req: Request, res: Response) => {
  try {
    const db = getDB();

    const search = getQueryString(req.query.search);
    const category = getQueryString(req.query.category);
    const location = getQueryString(req.query.location);
    const rentalType = getQueryString(req.query.rentalType);

    const minPriceValue = getQueryString(req.query.minPrice);
    const maxPriceValue = getQueryString(req.query.maxPrice);

    const minPrice =
      minPriceValue !== "" ? Number(minPriceValue) : undefined;

    const maxPrice =
      maxPriceValue !== "" ? Number(maxPriceValue) : undefined;

    const available = getQueryString(req.query.available);

    const requestedSort = getQueryString(req.query.sort);
    const sort: SortOption = isSortOption(requestedSort)
      ? requestedSort
      : "newest";

    if (rentalType && !isRentalType(rentalType)) {
      return sendError(res, 400, "Invalid rental type.");
    }

    if (
      minPrice !== undefined &&
      (!Number.isFinite(minPrice) || minPrice < 0)
    ) {
      return sendError(res, 400, "Invalid minimum price.");
    }

    if (
      maxPrice !== undefined &&
      (!Number.isFinite(maxPrice) || maxPrice < 0)
    ) {
      return sendError(res, 400, "Invalid maximum price.");
    }

    if (
      minPrice !== undefined &&
      maxPrice !== undefined &&
      minPrice > maxPrice
    ) {
      return sendError(
        res,
        400,
        "Minimum price cannot exceed maximum price."
      );
    }

    if (
      available &&
      available !== "true" &&
      available !== "false"
    ) {
      return sendError(res, 400, "Invalid availability filter.");
    }

    const filter: Filter<Equipment> = {
      status: "approved",
    };

    if (search) {
      const searchRegex = new RegExp(escapeRegex(search), "i");

      filter.$or = [
        { name: searchRegex },
        { category: searchRegex },
        { location: searchRegex },
        { brand: searchRegex },
        { model: searchRegex },
      ];
    }

    if (location) {
      filter.location = new RegExp(escapeRegex(location), "i");
    }

    if (category) {
      filter.category = category;
    }

    if (rentalType && isRentalType(rentalType)) {
      filter.rentalType = rentalType;
    }

    if (minPrice !== undefined || maxPrice !== undefined) {
      filter.pricePerDay = {
        ...(minPrice !== undefined ? { $gte: minPrice } : {}),
        ...(maxPrice !== undefined ? { $lte: maxPrice } : {}),
      };
    }

    if (available === "true") {
      filter.availableQuantity = { $gt: 0 };
    } else if (available === "false") {
      filter.availableQuantity = { $lte: 0 };
    }

    const sortOptions = {
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 },
      "price-asc": { pricePerDay: 1 },
      "price-desc": { pricePerDay: -1 },
    } as const;

    const equipment = await db
      .collection<Equipment>("equipment")
      .find(filter)
      .sort(sortOptions[sort])
      .toArray();

    return res.status(200).json({
      success: true,
      message: "Equipment fetched successfully.",
      data: equipment,
    });
  } catch (error) {
    console.error("Get equipment error:", error);

    return sendError(res, 500, "Failed to fetch equipment.");
  }
});

// ==========================================
// GET FEATURED EQUIPMENT
// SHOW LATEST 6 APPROVED ITEMS
// ==========================================

router.get("/featured", async (_req: Request, res: Response) => {
  try {
    const db = getDB();

    const equipment = await db
      .collection<Equipment>("equipment")
      .find({ status: "approved" })
      .sort({ createdAt: -1 })
      .limit(6)
      .toArray();

    return res.status(200).json({
      success: true,
      message: "Featured equipment fetched successfully.",
      data: equipment,
    });
  } catch (error) {
    console.error("Get featured equipment error:", error);

    return sendError(
      res,
      500,
      "Failed to fetch featured equipment."
    );
  }
});

// ==========================================
// GET OWNER'S EQUIPMENT
// OWNER ONLY
// ==========================================

router.get(
  "/my",
  // verifyToken,
  // verifyOwner,
  async (req: Request, res: Response) => {
    try {
      const ownerEmail = req.user?.email?.toLowerCase();

      if (!ownerEmail) {
        return sendError(res, 401, "User authentication required.");
      }

      const db = getDB();

      const equipment = await db
        .collection<Equipment>("equipment")
        .find({ ownerEmail })
        .sort({ createdAt: -1 })
        .toArray();

      return res.status(200).json({
        success: true,
        message: "Your equipment fetched successfully.",
        data: equipment,
      });
    } catch (error) {
      console.error("Get owner equipment error:", error);

      return sendError(res, 500, "Failed to fetch your equipment.");
    }
  }
);

// ==========================================
// GET SINGLE APPROVED EQUIPMENT
// PUBLIC ACCESS
// ==========================================

router.get(
  "/:id",
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      if (!isValidObjectId(id)) {
        return sendError(res, 400, "Invalid equipment ID.");
      }

      const db = getDB();

      const equipment = await db
        .collection<Equipment>("equipment")
        .findOne({
          _id: new ObjectId(id),
          status: "approved",
        });

      if (!equipment) {
        return sendError(res, 404, "Equipment not found.");
      }

      return res.status(200).json({
        success: true,
        message: "Equipment fetched successfully.",
        data: equipment,
      });
    } catch (error) {
      console.error("Get single equipment error:", error);

      return sendError(res, 500, "Failed to fetch equipment.");
    }
  }
);

// ==========================================
// ADD NEW EQUIPMENT
// OWNER ONLY
// ==========================================

router.post(
  "/",
  // verifyToken,
  // verifyOwner,
  async (req: Request, res: Response) => {
    try {
      const body = req.body as Record<string, unknown>;

      const {
        name,
        description,
        category,
        rentalType,
        pricePerDay,
        availableQuantity,
        condition,
        brand,
        model,
        location,
        image,
        termsAndConditions,
      } = body;

      const requiredStringFields = [
        name,
        description,
        category,
        condition,
        brand,
        model,
        location,
        image,
        termsAndConditions,
      ];

      const hasMissingField = requiredStringFields.some(
        (field) =>
          typeof field !== "string" || !field.trim()
      );

      if (
        hasMissingField ||
        pricePerDay === undefined ||
        availableQuantity === undefined
      ) {
        return sendError(
          res,
          400,
          "Please provide all required equipment information."
        );
      }

      if (!isRentalType(rentalType)) {
        return sendError(
          res,
          400,
          "Rental type must be daily, weekly or monthly."
        );
      }

      const price = Number(pricePerDay);
      const quantity = Number(availableQuantity);

      if (!Number.isFinite(price) || price <= 0) {
        return sendError(
          res,
          400,
          "Price must be a positive number."
        );
      }

      if (!Number.isInteger(quantity) || quantity <= 0) {
        return sendError(
          res,
          400,
          "Available quantity must be a positive integer."
        );
      }

      const ownerEmail = req.user?.email?.toLowerCase();

      if (!ownerEmail) {
        return sendError(res, 401, "User authentication required.");
      }

      const newEquipment: Equipment = {
        name: (name as string).trim(),
        description: (description as string).trim(),
        category: (category as string).trim(),
        rentalType,
        pricePerDay: price,
        availableQuantity: quantity,
        condition: (condition as string).trim(),
        brand: (brand as string).trim(),
        model: (model as string).trim(),
        location: (location as string).trim(),
        image: (image as string).trim(),
        termsAndConditions: (termsAndConditions as string).trim(),
        ownerEmail,
        status: "pending",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const db = getDB();

      const result = await db
        .collection<Equipment>("equipment")
        .insertOne(newEquipment);

      return res.status(201).json({
        success: true,
        message: "Equipment added successfully.",
        data: {
          _id: result.insertedId,
          ...newEquipment,
        },
      });
    } catch (error) {
      console.error("Add equipment error:", error);

      return sendError(res, 500, "Failed to add equipment.");
    }
  }
);

// ==========================================
// UPDATE EQUIPMENT
// OWNER OR ADMIN
// ==========================================

router.patch(
  "/:id",
  // verifyToken,
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      if (!isValidObjectId(id)) {
        return sendError(res, 400, "Invalid equipment ID.");
      }

      const user = req.user;

      if (!user || !["owner", "admin"].includes(user.role)) {
        return sendError(
          res,
          403,
          "Only owners or admins can update equipment."
        );
      }

      const body = req.body as Record<string, unknown>;

      const updates: Partial<Equipment> = {};

      const stringFields = [
        "name",
        "description",
        "category",
        "condition",
        "brand",
        "model",
        "location",
        "image",
        "termsAndConditions",
      ] as const;

      for (const field of stringFields) {
        const value = body[field];

        if (value === undefined) continue;

        if (typeof value !== "string" || !value.trim()) {
          return sendError(
            res,
            400,
            `${field} must be a non-empty string.`
          );
        }

        updates[field] = value.trim();
      }

      if (body.rentalType !== undefined) {
        if (!isRentalType(body.rentalType)) {
          return sendError(
            res,
            400,
            "Rental type must be daily, weekly or monthly."
          );
        }

        updates.rentalType = body.rentalType;
      }

      if (body.pricePerDay !== undefined) {
        const price = Number(body.pricePerDay);

        if (!Number.isFinite(price) || price <= 0) {
          return sendError(
            res,
            400,
            "Price must be a positive number."
          );
        }

        updates.pricePerDay = price;
      }

      if (body.availableQuantity !== undefined) {
        const quantity = Number(body.availableQuantity);

        if (!Number.isInteger(quantity) || quantity <= 0) {
          return sendError(
            res,
            400,
            "Available quantity must be a positive integer."
          );
        }

        updates.availableQuantity = quantity;
      }

      if (Object.keys(updates).length === 0) {
        return sendError(
          res,
          400,
          "No valid update information provided."
        );
      }

      updates.updatedAt = new Date();

      const db = getDB();
      const equipmentId = new ObjectId(id);

      const filter =
        user.role === "admin"
          ? { _id: equipmentId }
          : {
              _id: equipmentId,
              ownerEmail: user.email.toLowerCase(),
            };

      const updatedEquipment = await db
        .collection<Equipment>("equipment")
        .findOneAndUpdate(
          filter,
          { $set: updates },
          { returnDocument: "after" }
        );

      if (!updatedEquipment) {
        return sendError(
          res,
          404,
          "Equipment not found or you do not own it."
        );
      }

      return res.status(200).json({
        success: true,
        message: "Equipment updated successfully.",
        data: updatedEquipment,
      });
    } catch (error) {
      console.error("Update equipment error:", error);

      return sendError(res, 500, "Failed to update equipment.");
    }
  }
);

// ==========================================
// DELETE EQUIPMENT
// OWNER OR ADMIN
// ==========================================

router.delete(
  "/:id",
  // verifyToken,
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      if (!isValidObjectId(id)) {
        return sendError(res, 400, "Invalid equipment ID.");
      }

      const user = req.user;

      if (!user || !["owner", "admin"].includes(user.role)) {
        return sendError(
          res,
          403,
          "Only owners or admins can delete equipment."
        );
      }

      const db = getDB();
      const equipmentId = new ObjectId(id);

      const filter =
        user.role === "admin"
          ? { _id: equipmentId }
          : {
              _id: equipmentId,
              ownerEmail: user.email.toLowerCase(),
            };

      const result = await db
        .collection<Equipment>("equipment")
        .deleteOne(filter);

      if (result.deletedCount === 0) {
        return sendError(
          res,
          404,
          "Equipment not found or you do not own it."
        );
      }

      return res.status(200).json({
        success: true,
        message: "Equipment deleted successfully.",
      });
    } catch (error) {
      console.error("Delete equipment error:", error);

      return sendError(res, 500, "Failed to delete equipment.");
    }
  }
);

export default router;
