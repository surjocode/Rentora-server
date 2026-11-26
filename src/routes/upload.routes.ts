
import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";

// import {
//   verifyToken,
//   verifyOwner,
// } from "../middleware/auth.middleware.js";

const router = Router();

// ==========================================
// CONFIGURATION
// ==========================================

const MAX_FILE_SIZE = 5 * 1024 * 1024;

const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];

// ==========================================
// TYPES
// ==========================================

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

// ==========================================
// MULTER CONFIGURATION
// ==========================================

const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1,
  },

  fileFilter: (_req, file, callback) => {
    if (!ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
      callback(
        new Error("Only JPEG, PNG, WebP and GIF images are allowed.")
      );
      return;
    }

    callback(null, true);
  },
});

// ==========================================
// UPLOAD ERROR HANDLER
// ==========================================

const handleUpload = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  upload.single("image")(req, res, (error: unknown) => {
    if (error instanceof multer.MulterError) {
      const isTooLarge = error.code === "LIMIT_FILE_SIZE";

      res.status(isTooLarge ? 413 : 400).json({
        success: false,
        message: isTooLarge
          ? "Image size cannot exceed 5 MB."
          : "Image upload failed.",
      });

      return;
    }

    if (error) {
      res.status(400).json({
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Invalid image upload.",
      });

      return;
    }

    next();
  });
};

// ==========================================
// UPLOAD EQUIPMENT IMAGE
// ==========================================

router.post(
  "/",
  // verifyToken,
  // verifyOwner,
  handleUpload,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const image = req.file;

      if (!image) {
        res.status(400).json({
          success: false,
          message: "Please select a valid image file.",
        });

        return;
      }

      const apiKey = process.env.IMGBB_API_KEY;

      if (!apiKey) {
        console.error("IMGBB_API_KEY is missing.");

        res.status(500).json({
          success: false,
          message: "Image upload configuration is missing.",
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
        signal: AbortSignal.timeout(30_000),
      });

      const result = (await response.json()) as ImgBBResponse;

      if (!response.ok || !result.success || !result.data?.url) {
        console.error("ImgBB upload failed:", {
          status: response.status,
          message: result.error?.message || "Unknown ImgBB error.",
        });

        res.status(502).json({
          success: false,
          message: "Failed to upload image to ImgBB.",
        });

        return;
      }

      res.status(200).json({
        success: true,
        message: "Image uploaded successfully.",
        data: {
          url: result.data.url,
        },
      });
    } catch (error) {
      console.error("Image upload error:", error);

      const isTimeout =
        error instanceof Error && error.name === "TimeoutError";

      res.status(isTimeout ? 504 : 500).json({
        success: false,
        message: isTimeout
          ? "Image upload request timed out. Please try again."
          : "Something went wrong while uploading the image.",
      });
    }
  }
);

export default router;
