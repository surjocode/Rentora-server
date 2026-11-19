
import { Router, type Request, type Response } from "express";
import { getDB } from "../server.js";

const router = Router();

// Get All Categories
router.get("/", async (_req: Request, res: Response) => {
  try {
    const db = getDB();

    const categories = await db
      .collection("equipment")
      .distinct("category", { status: "approved" });

    res.status(200).json({
      success: true,
      message: "Categories fetched successfully",
      data: categories,
    });
  } catch (error) {
    console.error("Get categories error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch categories",
    });
  }
});

export default router;
