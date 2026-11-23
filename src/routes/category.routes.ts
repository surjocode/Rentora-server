
import { Router, type Request, type Response } from "express";

import { getDB } from "../server.js";

const router = Router();

// ==========================================
// GET ALL APPROVED EQUIPMENT CATEGORIES
// ==========================================

router.get("/", async (_req: Request, res: Response) => {
  try {
    const db = getDB();

    const categories = await db
      .collection("equipment")
      .distinct("category", {
        status: "approved",
      });

    const sortedCategories = categories
      .filter(
        (category): category is string =>
          typeof category === "string" && category.trim().length > 0
      )
      .sort((a, b) => a.localeCompare(b));

    return res.status(200).json({
      success: true,
      message: "Categories fetched successfully.",
      data: sortedCategories,
    });
  } catch (error) {
    console.error("Get categories error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch categories.",
    });
  }
});

export default router;
