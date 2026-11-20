
import { Router, type Request, type Response } from "express";
import multer from "multer";
import { verifyToken, verifyOwner } from "../middleware/auth.middleware.js";

const router = Router();

// Image upload configuration
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // Maximum 5 MB
  },
  fileFilter: (_req, file, callback) => {
    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
    ];

    if (!allowedTypes.includes(file.mimetype)) {
      callback(null, false);
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
        res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({
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
          message: "Invalid image upload",
        });
        return;
      }

      next();
    });
  },
  async (req: Request, res: Response) => {
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

      // Upload image to ImgBB
      const response = await fetch(
        `https://api.imgbb.com/1/upload?key=${apiKey}`,
        {
          method: "POST",
          body: formData,
        }
      );

      const result = (await response.json()) as ImgBBResponse;

      if (!response.ok || !result.success || !result.data?.url) {
        res.status(502).json({
          success: false,
          message: result.error?.message || "Failed to upload image",
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
      console.error("Image upload error:", error);

      res.status(500).json({
        success: false,
        message: "Something went wrong while uploading image",
      });
    }
  }
);

export default router;
