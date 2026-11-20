
import { Router, type Request, type Response } from "express";
import multer from "multer";
import { verifyToken, verifyOwner } from "../middleware/auth.middleware.js";

const router = Router();

// Image upload configuration
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
  fileFilter: (_req, file, callback) => {
    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
    ];

    if (!allowedTypes.includes(file.mimetype)) {
      callback(new Error("Only JPEG, PNG, WebP and GIF images are allowed"));
      return;
    }

    callback(null, true);
  },
});

// ImgBB response type
interface ImgBBResponse {
  success: boolean;
  data?: {
    url: string;
    display_url?: string;
  };
  error?: {
    message?: string;
  };
}

// Upload Equipment Image
router.post(
  "/",
  verifyToken,
  verifyOwner,
  (req, res, next) => {
    upload.single("image")(req, res, (error) => {
      if (error instanceof multer.MulterError) {
        res.status(
          error.code === "LIMIT_FILE_SIZE" ? 413 : 400
        ).json({
          success: false,
          message:
            error.code === "LIMIT_FILE_SIZE"
              ? "Image size cannot exceed 5 MB"
              : "Image upload failed",
        });
        return;
      }

      if (error) {
        res.status(400).json({
          success: false,
          message:
            error instanceof Error
              ? error.message
              : "Invalid image upload",
        });
        return;
      }

      next();
    });
  },
  async (req: Request, res: Response): Promise<void> => {
    try {
      const image = req.file;

      if (!image) {
        res.status(400).json({
          success: false,
          message: "Please select a valid image file",
        });
        return;
      }

      const apiKey = process.env.IMGBB_API_KEY;
     

      if (!apiKey) {
        console.error("IMGBB_API_KEY is missing");

        res.status(500).json({
          success: false,
          message: "Image upload configuration is missing",
        });
        return;
      }

      // Convert image to Base64
      const base64Image = image.buffer.toString("base64");

      const formData = new URLSearchParams();
      formData.append("image", base64Image);

      // ImgBB API URL
      const uploadURL = new URL("https://api.imgbb.com/1/upload");
      uploadURL.searchParams.set("key", apiKey);

      // Upload image to ImgBB
      const response = await fetch(uploadURL, {
        method: "POST",
        body: formData,
      });

      const result = (await response.json()) as ImgBBResponse;

      if (!response.ok || !result.success || !result.data?.url) {
        console.error("ImgBB upload failed:", {
          status: response.status,
          message: result.error?.message || "Unknown ImgBB error",
        });

        res.status(502).json({
          success: false,
          message:
            result.error?.message || "Failed to upload image to ImgBB",
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: "Image uploaded successfully",
        data: {
          url: result.data.url,
        },
      });
    } catch (error) {
      console.error(
        "Image upload error:",
        error instanceof Error ? error.message : "Unknown error"
      );

      res.status(500).json({
        success: false,
        message: "Something went wrong while uploading image",
      });
    }
  }
);

export default router;
