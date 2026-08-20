import { describe, expect, test } from "bun:test";
import { photoMessageText, voiceMessageText } from "./MediaUnderstanding";
import { formatTelegramWebhook } from "../platforms/TelegramAdapter";

describe("photoMessageText", () => {
  test("keeps the caption — it is usually the actual question", () => {
    const text = photoMessageText(
      { description: "a shoulder-length ash blonde balayage", intent_hint: "wants this colour" },
      "is this something you do?"
    );
    expect(text).toContain("ash blonde balayage");
    expect(text).toContain("is this something you do?");
  });

  test("falls back to the intent hint when there is no caption", () => {
    const text = photoMessageText(
      { description: "a bridal updo", intent_hint: "bridal styling" },
      ""
    );
    expect(text).toContain("bridal updo");
    expect(text).toContain("bridal styling");
  });

  test("does not double the full stop when Gemini already ends with one", () => {
    const text = photoMessageText(
      { description: "A flag with three horizontal stripes.", intent_hint: "colour reference" },
      "is this something you do?"
    );
    expect(text).not.toContain("..");
    expect(text).toContain("stripes. They ask:");
  });

  test("says the photo could not be viewed rather than pretending it was", () => {
    const text = photoMessageText(null, "can you do this?");
    expect(text).toContain("could not be viewed");
    expect(text).toContain("can you do this?");
  });
});

describe("voiceMessageText", () => {
  test("a transcript replaces the placeholder entirely", () => {
    expect(voiceMessageText("Do you have Saturday slots?", "")).toBe("Do you have Saturday slots?");
  });

  test("a caption is kept alongside the transcript", () => {
    expect(voiceMessageText("Saturday free?", "for two people")).toBe(
      "Saturday free? (for two people)"
    );
  });

  test("an unreadable note is labelled, not silently dropped", () => {
    expect(voiceMessageText(null, "")).toContain("could not be transcribed");
  });
});

describe("formatTelegramWebhook media parsing", () => {
  const from = { id: 42, first_name: "Kasun", language_code: "en" };
  const chat = { id: 42, type: "private" };

  test("a photo with no caption is not labelled a voice message", () => {
    const result = formatTelegramWebhook({
      message: { from, chat, message_id: 1, photo: [{ file_id: "small" }, { file_id: "large" }] }
    }) as Record<string, unknown>;

    expect(result.message).toBe("[Photo]");
    expect(result.message).not.toBe("[Voice Message]");
    expect(result._photo_file_id).toBe("large");
    expect(result._caption).toBe("");
  });

  test("a photo caption travels separately so it can be kept with the description", () => {
    const result = formatTelegramWebhook({
      message: {
        from,
        chat,
        message_id: 2,
        photo: [{ file_id: "large" }],
        caption: "is this something you do?"
      }
    }) as Record<string, unknown>;

    expect(result._caption).toBe("is this something you do?");
    expect(result._photo_file_id).toBe("large");
  });

  test("the largest photo size is chosen", () => {
    const result = formatTelegramWebhook({
      message: {
        from,
        chat,
        message_id: 3,
        photo: [{ file_id: "thumb" }, { file_id: "mid" }, { file_id: "full" }]
      }
    }) as Record<string, unknown>;

    expect(result._photo_file_id).toBe("full");
  });

  test("a voice note carries its file id for transcription", () => {
    const result = formatTelegramWebhook({
      message: { from, chat, message_id: 4, voice: { file_id: "voice_1" } }
    }) as Record<string, unknown>;

    expect(result._audio_file_id).toBe("voice_1");
    expect(result.message).toBe("[Voice Message]");
  });

  test("plain text messages are untouched by the media path", () => {
    const result = formatTelegramWebhook({
      message: { from, chat, message_id: 5, text: "hello" }
    }) as Record<string, unknown>;

    expect(result.message).toBe("hello");
    expect(result._photo_file_id).toBeUndefined();
    expect(result._audio_file_id).toBeUndefined();
    expect(result._caption).toBeUndefined();
  });
});
