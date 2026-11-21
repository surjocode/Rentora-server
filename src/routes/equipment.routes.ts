
import { Router, type Request, type Response } from "express";
import { ObjectId, type Filter } from "mongodb";
import { getDB } from "../server.js";
import {
  verifyToken,
  verifyOwner,
} from "../middleware/auth.middleware.js";

const router = Router();

// Equipment Interface
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

type SortOption =
  | "newest"
  | "oldest"
  | "price-asc"
  | "price-desc";

const rentalTypes = ["daily", "weekly", "monthly"] as const;

// Get All Approved Equipment with Search, Filter and Sort
router.get("/", async (req: Request, res: Response) => {
  try {
    const db = getDB();

    const search =
      typeof req.query.search === "string"
        ? req.query.search.trim()
        : "";

    const category =
      typeof req.query.category === "string"
        ? req.query.category.trim()
        : "";

    const rentalType =
      typeof req.query.rentalType === "string"
        ? req.query.rentalType.trim()
        : "";

    const minPrice =
      typeof req.query.minPrice === "string"
        ? Number(req.query.minPrice)
        : undefined;

    const maxPrice =
      typeof req.query.maxPrice === "string"
        ? Number(req.query.maxPrice)
        : undefined;

    const availableOnly = req.query.available === "true";

    const requestedSort =
      typeof req.query.sort === "string"
        ? req.query.sort
        : "newest";

    const validSortOptions: SortOption[] = [
      "newest",
      "oldest",
      "price-asc",
      "price-desc",
    ];

    const sort: SortOption = validSortOptions.includes(
      requestedSort as SortOption
    )
      ? (requestedSort as SortOption)
      : "newest";

    const filter: Filter<Equipment> = {
      status: "approved",
    };

    // Search by name, category, location, brand or model
    if (search) {
      const escapedSearch = search.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
      );

      const searchRegex = new RegExp(escapedSearch, "i");

      filter.$or = [
        { name: searchRegex },
        { category: searchRegex },
        { location: searchRegex },
        { brand: searchRegex },
        { model: searchRegex },
      ];
    }

    // Filter by category
    if (category) {
      filter.category = category;
    }

    // Filter by rental type
    if (rentalType) {
      if (!rentalTypes.includes(rentalType as (typeof rentalTypes)[number])) {
        res.status(400).json({
          success: false,
          message: "Invalid rental type",
        });
        return;
      }

      filter.rentalType = rentalType as Equipment["rentalType"];
    }

    // Filter by minimum and maximum price
    if (
      minPrice !== undefined &&
      (!Number.isFinite(minPrice) || minPrice < 0)
    ) {
      res.status(400).json({
        success: false,
        message: "Invalid minimum price",
      });
      return;
    }

    if (
      maxPrice !== undefined &&
      (!Number.isFinite(maxPrice) || maxPrice < 0)
    ) {
      res.status(400).json({
        success: false,
        message: "Invalid maximum price",
      });
      return;
    }

    if (
      minPrice !== undefined &&
      maxPrice !== undefined &&
      minPrice > maxPrice
    ) {
      res.status(400).json({
        success: false,
        message: "Minimum price cannot exceed maximum price",
      });
      return;
    }

    if (minPrice !== undefined || maxPrice !== undefined) {
      filter.pricePerDay = {
        ...(minPrice !== undefined ? { $gte: minPrice } : {}),
        ...(maxPrice !== undefined ? { $lte: maxPrice } : {}),
      };
    }

    // Show only equipment with available quantity
    if (availableOnly) {
      filter.availableQuantity = { $gt: 0 };
    }

    // Sorting options
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

    res.status(200).json({
      success: true,
      message: "Equipment fetched successfully",
      data: equipment,
    });
  } catch (error) {
    console.error("Get equipment error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch equipment",
    });
  }
});

// Get All Equipment Belonging to Logged-in Owner
router.get(
  "/my",
  verifyToken,
  verifyOwner,
  async (req: Request, res: Response) => {
    try {
      const ownerEmail = req.user?.email;

      if (!ownerEmail) {
        res.status(401).json({
          success: false,
          message: "User authentication required",
        });
        return;
      }

      const db = getDB();

      const equipment = await db
        .collection<Equipment>("equipment")
        .find({
          ownerEmail: ownerEmail.toLowerCase(),
        })
        .sort({ createdAt: -1 })
        .toArray();

      res.status(200).json({
        success: true,
        message: "Your equipment fetched successfully",
        data: equipment,
      });
    } catch (error) {
      console.error("Get owner equipment error:", error);

      res.status(500).json({
        success: false,
        message: "Failed to fetch your equipment",
      });
    }
  }
);

// Get Single Approved Equipment
router.get(
  "/:id",
  verifyToken,
  async (req: Request, res: Response) => {
    try {
      const id = req.params.id;

      if (typeof id !== "string" || !ObjectId.isValid(id)) {
        res.status(400).json({
          success: false,
          message: "Invalid equipment ID",
        });
        return;
      }

      const db = getDB();

      // Find equipment by ID
      const equipment = await db
        .collection<Equipment>("equipment")
        .findOne({
          _id: new ObjectId(id),
        });

      if (!equipment) {
        res.status(404).json({
          success: false,
          message: "Equipment not found",
        });
        return;
      }

      // Get logged-in user's information
      const currentUserEmail = req.user?.email?.toLowerCase();
      const currentUserRole = req.user?.role;

      // Check access permission
      const isApproved = equipment.status === "approved";

      const isOwner =
        currentUserRole === "owner" &&
        equipment.ownerEmail.toLowerCase() === currentUserEmail;

      const isAdmin = currentUserRole === "admin";

      // Only approved equipment or authorized owner/admin can view
      if (!isApproved && !isOwner && !isAdmin) {
        res.status(404).json({
          success: false,
          message: "Equipment not found",
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: equipment,
      });
    } catch (error) {
      console.error("Get single equipment error:", error);

      res.status(500).json({
        success: false,
        message: "Failed to fetch equipment",
      });
    }
  }
);

// Add New Equipment (Owner Only)
router.post(
  "/",
  verifyToken,
  verifyOwner,
  async (req: Request, res: Response) => {
    try {
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
      } = req.body;

      const requiredFields = [
        name,
        description,
        category,
        rentalType,
        condition,
        brand,
        model,
        location,
        image,
        termsAndConditions,
      ];

      if (
        requiredFields.some(
          (field) => typeof field !== "string" || !field.trim()
        ) ||
        pricePerDay === undefined ||
        availableQuantity === undefined
      ) {
        res.status(400).json({
          success: false,
          message: "Please provide all required equipment information",
        });
        return;
      }

      if (!rentalTypes.includes(rentalType)) {
        res.status(400).json({
          success: false,
          message: "Rental type must be daily, weekly or monthly",
        });
        return;
      }

      const price = Number(pricePerDay);
      const quantity = Number(availableQuantity);

      if (!Number.isFinite(price) || price <= 0) {
        res.status(400).json({
          success: false,
          message: "Price must be a positive number",
        });
        return;
      }

      if (!Number.isInteger(quantity) || quantity <= 0) {
        res.status(400).json({
          success: false,
          message: "Available quantity must be a positive integer",
        });
        return;
      }

      const ownerEmail = req.user?.email;

      if (!ownerEmail) {
        res.status(401).json({
          success: false,
          message: "User authentication required",
        });
        return;
      }

      const db = getDB();

      const newEquipment: Equipment = {
        name: name.trim(),
        description: description.trim(),
        category: category.trim(),
        rentalType,
        pricePerDay: price,
        availableQuantity: quantity,
        condition: condition.trim(),
        brand: brand.trim(),
        model: model.trim(),
        location: location.trim(),
        image: image.trim(),
        termsAndConditions: termsAndConditions.trim(),
        ownerEmail: ownerEmail.toLowerCase(),
        status: "pending",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await db
        .collection<Equipment>("equipment")
        .insertOne(newEquipment);

      res.status(201).json({
        success: true,
        message: "Equipment added successfully",
        data: {
          _id: result.insertedId,
          ...newEquipment,
        },
      });
    } catch (error) {
      console.error("Add equipment error:", error);

      res.status(500).json({
        success: false,
        message: "Failed to add equipment",
      });
    }
  }
);

// Update Equipment (Owner or Admin)
router.patch(
  "/:id",
  verifyToken,
  async (req: Request, res: Response) => {
    try {
      const id = req.params.id;

      if (typeof id !== "string" || !ObjectId.isValid(id)) {
        res.status(400).json({
          success: false,
          message: "Invalid equipment ID",
        });
        return;
      }

      const user = req.user;

      if (!user || !["owner", "admin"].includes(user.role)) {
        res.status(403).json({
          success: false,
          message: "Only owners or admins can update equipment",
        });
        return;
      }

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
      } = req.body;

      const updates: Partial<Equipment> = {};

      const stringFields = {
        name,
        description,
        category,
        condition,
        brand,
        model,
        location,
        image,
        termsAndConditions,
      };

      for (const [key, value] of Object.entries(stringFields)) {
        if (value !== undefined) {
          if (typeof value !== "string" || !value.trim()) {
            res.status(400).json({
              success: false,
              message: `${key} must be a non-empty string`,
            });
            return;
          }

          if (key === "name") updates.name = value.trim();
          if (key === "description") updates.description = value.trim();
          if (key === "category") updates.category = value.trim();
          if (key === "condition") updates.condition = value.trim();
          if (key === "brand") updates.brand = value.trim();
          if (key === "model") updates.model = value.trim();
          if (key === "location") updates.location = value.trim();
          if (key === "image") updates.image = value.trim();
          if (key === "termsAndConditions")
            updates.termsAndConditions = value.trim();
        }
      }

      if (rentalType !== undefined) {
        if (
          typeof rentalType !== "string" ||
          !rentalTypes.includes(rentalType as (typeof rentalTypes)[number])
        ) {
          res.status(400).json({
            success: false,
            message: "Rental type must be daily, weekly or monthly",
          });
          return;
        }

        updates.rentalType = rentalType as Equipment["rentalType"];
      }

      if (pricePerDay !== undefined) {
        const price = Number(pricePerDay);

        if (!Number.isFinite(price) || price <= 0) {
          res.status(400).json({
            success: false,
            message: "Price must be a positive number",
          });
          return;
        }

        updates.pricePerDay = price;
      }

      if (availableQuantity !== undefined) {
        const quantity = Number(availableQuantity);

        if (!Number.isInteger(quantity) || quantity <= 0) {
          res.status(400).json({
            success: false,
            message: "Available quantity must be a positive integer",
          });
          return;
        }

        updates.availableQuantity = quantity;
      }

      if (Object.keys(updates).length === 0) {
        res.status(400).json({
          success: false,
          message: "No valid update information provided",
        });
        return;
      }

      updates.updatedAt = new Date();

      const db = getDB();

      const filter =
        user.role === "admin"
          ? { _id: new ObjectId(id) }
          : {
              _id: new ObjectId(id),
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
        res.status(404).json({
          success: false,
          message: "Equipment not found or you do not own it",
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: "Equipment updated successfully",
        data: updatedEquipment,
      });
    } catch (error) {
      console.error("Update equipment error:", error);

      res.status(500).json({
        success: false,
        message: "Failed to update equipment",
      });
    }
  }
);

// Delete Equipment (Owner or Admin)
router.delete(
  "/:id",
  verifyToken,
  async (req: Request, res: Response) => {
    try {
      const id = req.params.id;

      if (typeof id !== "string" || !ObjectId.isValid(id)) {
        res.status(400).json({
          success: false,
          message: "Invalid equipment ID",
        });
        return;
      }

      const user = req.user;

      if (!user || !["owner", "admin"].includes(user.role)) {
        res.status(403).json({
          success: false,
          message: "Only owners or admins can delete equipment",
        });
        return;
      }

      const db = getDB();

      const filter =
        user.role === "admin"
          ? { _id: new ObjectId(id) }
          : {
              _id: new ObjectId(id),
              ownerEmail: user.email.toLowerCase(),
            };

      const result = await db
        .collection<Equipment>("equipment")
        .deleteOne(filter);

      if (result.deletedCount === 0) {
        res.status(404).json({
          success: false,
          message: "Equipment not found or you do not own it",
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: "Equipment deleted successfully",
      });
    } catch (error) {
      console.error("Delete equipment error:", error);

      res.status(500).json({
        success: false,
        message: "Failed to delete equipment",
      });
    }
  }
);

export default router;
