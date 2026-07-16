/**
 * StorageService
 *
 * Uploads files to PocketBase bucket storage and returns a public URL.
 * Used to host user-sent images (e.g. Telegram photos) so the vision API
 * can reach them over a public URL.
 */

import { CORRELATION_ID_HEADER } from "../middleware/correlationId";

// Internal URL used for API calls (can be a Docker service name)
const POCKETBASE_URL = (process.env.POCKETBASE_URL ?? "").replace(/\/$/, "");
// Public URL used in returned file links so external services (vision API) can fetch them
const POCKETBASE_PUBLIC_URL = (process.env.POCKETBASE_PUBLIC_URL ?? POCKETBASE_URL).replace(/\/$/, "");
const POCKETBASE_COLLECTION = process.env.POCKETBASE_COLLECTION ?? "media_uploads";

/**
 * Upload a file buffer to PocketBase.
 * Returns the public file URL, or null if PocketBase is not configured.
 */

export async function uploadToStorage(
  data: Uint8Array,
  filename: string,
  mimeType: string,
  requestId?: string,
  collection?: string
): Promise<string | null> {
  if (!POCKETBASE_URL) {
    console.warn("[storage] POCKETBASE_URL not set — skipping upload");
    return null;
  }

  const col = collection ?? POCKETBASE_COLLECTION;
  const formData = new FormData();
  const blob = new Blob([data], { type: mimeType });
  formData.append("file", blob, filename);

  const response = await fetch(
    `${POCKETBASE_URL}/api/collections/${col}/records`,
    {
      method: "POST",
      headers: requestId ? { [CORRELATION_ID_HEADER]: requestId } : undefined,
      body: formData
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`PocketBase upload failed ${response.status}: ${text}`);
  }

  const record = (await response.json()) as { id: string; file: string };
  return `${POCKETBASE_PUBLIC_URL}/api/files/${col}/${record.id}/${record.file}`;
}
