import { Elysia, t } from "elysia";
import {
  CORRELATION_ID_HEADER,
  correlationIdMiddleware,
  generateCorrelationId,
  logWithCorrelation
} from "../middleware/correlationId";
import { uploadToStorage } from "../services/StorageService";

export const uploadRoutes = new Elysia({ prefix: "/api" })
  .use(correlationIdMiddleware)
  .post(
    "/upload-image",
    async (context) => {
      const { body, set } = context;
      const correlationId =
        (context as { correlationId?: string }).correlationId ?? generateCorrelationId();
      set.headers[CORRELATION_ID_HEADER] = correlationId;

      try {
        const file = body.file;
        const mimeType = file.type?.trim() || "";
        if (!mimeType.startsWith("image/")) {
          set.status = 400;
          return {
            success: false,
            error: "Only image files are allowed",
          };
        }

        logWithCorrelation(
          correlationId,
          "IMAGE_UPLOAD_RECEIVED",
          `name=${file.name || "unknown"} size=${file.size} mime=${mimeType}`
        );

        const bytes = new Uint8Array(await file.arrayBuffer());
        const safeFilename = file.name?.trim() || `upload-${Date.now()}.bin`;
        const uploadedUrl = await uploadToStorage(bytes, safeFilename, mimeType, correlationId);

        if (!uploadedUrl) {
          set.status = 503;
          logWithCorrelation(
            correlationId,
            "IMAGE_UPLOAD_FAILED",
            "storage not configured or unavailable",
            "warn"
          );
          return {
            success: false,
            error: "Image storage is unavailable",
          };
        }

        logWithCorrelation(
          correlationId,
          "MEDIA_UPLOADED",
          `platform=web image_url=${uploadedUrl}`
        );

        return {
          success: true,
          url: uploadedUrl,
          request_id: correlationId,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        set.status = 500;
        logWithCorrelation(correlationId, "IMAGE_UPLOAD_ERROR", errorMessage, "error");
        return {
          success: false,
          error: errorMessage,
        };
      }
    },
    {
      body: t.Object({
        file: t.File(),
      }),
      detail: {
        summary: "Upload image file",
        description: "Uploads an image to configured storage and returns a public URL.",
        tags: ["Messaging"],
      },
    }
  );
