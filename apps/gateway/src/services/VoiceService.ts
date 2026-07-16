/**
 * VoiceService
 *
 * Integrates with the Speech-to-Text / Text-to-Speech API (Txt-Spch-And-Spch-Txt).
 * - transcribeAudio: converts an audio URL to text via the STT endpoint
 * - synthesizeSpeech: converts text to audio, uploads to PocketBase, returns public URL
 * - uploadVoiceToStorage: helper to upload audio bytes to the voice_messages collection
 */

import { CORRELATION_ID_HEADER } from "../middleware/correlationId";
import { uploadToStorage } from "./StorageService";

const STT_TTS_URL = (process.env.STT_TTS_API_URL ?? "").replace(/\/$/, "");

export const VOICE_PB_COLLECTION =
  process.env.POCKETBASE_VOICE_COLLECTION ?? "voice_messages";

export interface SttResult {
  text: string;
  language: string;
}

function inferAudioMimeType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "mp3") return "audio/mpeg";
  if (ext === "ogg" || ext === "oga") return "audio/ogg";
  if (ext === "m4a" || ext === "mp4") return "audio/mp4";
  if (ext === "aac") return "audio/aac";
  if (ext === "amr") return "audio/amr";
  if (ext === "wav") return "audio/wav";
  return "application/octet-stream";
}

/**
 * Upload raw audio bytes to the PocketBase voice_messages collection.
 */
export async function uploadVoiceToStorage(
  data: Uint8Array,
  filename: string,
  mimeType: string,
  requestId?: string
): Promise<string | null> {
  return uploadToStorage(data, filename, mimeType, requestId, VOICE_PB_COLLECTION);
}

/**
 * Call the STT API with a publicly accessible audio URL.
 * Returns the transcription and detected language, or null if unavailable/failed.
 */
export async function transcribeAudio(
  audioUrl: string,
  requestId?: string
): Promise<SttResult | null> {
  if (!STT_TTS_URL) {
    console.warn("[voice] STT_TTS_API_URL not set — skipping transcription");
    return null;
  }

  const response = await fetch(`${STT_TTS_URL}/speech-to-text/url`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(requestId ? { [CORRELATION_ID_HEADER]: requestId } : {})
    },
    body: JSON.stringify({ url: audioUrl })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`STT API error ${response.status}: ${text}`);
  }

  const result = (await response.json()) as { text?: string; language?: string };
  if (!result.text?.trim()) return null;

  return { text: result.text.trim(), language: result.language ?? "en" };
}

/**
 * Call the STT API with raw audio bytes using multipart form-data.
 * Returns the transcription and detected language, or null if unavailable/failed.
 */
export async function transcribeAudioFile(
  data: Uint8Array,
  filename: string,
  mimeType: string,
  requestId?: string
): Promise<SttResult | null> {
  if (!STT_TTS_URL) {
    console.warn("[voice] STT_TTS_API_URL not set — skipping transcription");
    return null;
  }

  const form = new FormData();
  const blob = new Blob([data], { type: mimeType || "application/octet-stream" });
  form.append("audio_file", blob, filename || `audio_${Date.now()}.wav`);

  const response = await fetch(`${STT_TTS_URL}/speech-to-text/file`, {
    method: "POST",
    headers: {
      ...(requestId ? { [CORRELATION_ID_HEADER]: requestId } : {})
    },
    body: form
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`STT API file error ${response.status}: ${text}`);
  }

  const result = (await response.json()) as { text?: string; language?: string };
  if (!result.text?.trim()) return null;

  return { text: result.text.trim(), language: result.language ?? "en" };
}

/**
 * Call the TTS API to synthesize text, then download the audio and upload it to
 * PocketBase so it is accessible via a stable public URL.
 * Returns the public PocketBase URL, or null if unavailable/failed.
 */
export async function synthesizeSpeech(
  text: string,
  requestId?: string,
  language?: string
): Promise<string | null> {
  if (!STT_TTS_URL) {
    console.warn("[voice] STT_TTS_API_URL not set — skipping synthesis");
    return null;
  }

  const requestedFilename = `tts_${Date.now()}.mp3`;

  const ttsResponse = await fetch(`${STT_TTS_URL}/text-to-speech/file`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(requestId ? { [CORRELATION_ID_HEADER]: requestId } : {})
    },
    body: JSON.stringify({ text, filename: requestedFilename, ...(language ? { language } : {}) })
  });

  if (!ttsResponse.ok) {
    const errText = await ttsResponse.text();
    throw new Error(`TTS API error ${ttsResponse.status}: ${errText}`);
  }

  const ttsResult = (await ttsResponse.json()) as {
    audio_url?: string;
    filename?: string;
  };

  if (!ttsResult.audio_url) return null;
  const resolvedFilename = (ttsResult.filename || requestedFilename).trim() || requestedFilename;

  // Download the generated audio from the TTS service (internal URL)
  const audioResponse = await fetch(ttsResult.audio_url, {
    headers: requestId ? { [CORRELATION_ID_HEADER]: requestId } : {}
  });

  if (!audioResponse.ok) {
    throw new Error(`Failed to download TTS audio: ${audioResponse.status}`);
  }

  const buffer = await audioResponse.arrayBuffer();
  const audioData = new Uint8Array(buffer);
  const responseMimeType = audioResponse.headers.get("content-type")?.split(";")[0].trim() ?? "";
  const mimeType = responseMimeType || inferAudioMimeType(resolvedFilename);

  // Upload to PocketBase voice_messages collection and return the public URL
  return uploadVoiceToStorage(audioData, resolvedFilename, mimeType, requestId);
}
