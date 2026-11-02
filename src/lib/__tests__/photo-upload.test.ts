import { afterEach, describe, expect, it, vi } from "vitest";
import { uploadPhoto, type UploadResult } from "@/lib/photo-upload";

// Node has no createImageBitmap, so shrinkPhoto hands each file back as it is
// and these tests cover what happens around the request.

function photo(bytes: number, type = "image/jpeg") {
  return new File([new Uint8Array(bytes)], "cake.jpg", { type });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("uploadPhoto", () => {
  it("sends the photo and any extra fields", async () => {
    const action = vi.fn<(formData: FormData) => Promise<UploadResult>>(async () => ({
      ok: true,
      url: "u",
    }));
    const result = await uploadPhoto(photo(1000), action, { productId: "p1" });
    expect(result).toEqual({ ok: true, url: "u" });
    const sent = action.mock.calls[0][0];
    expect(sent.get("file")).toBeInstanceOf(File);
    expect(sent.get("productId")).toBe("p1");
  });

  it("refuses a photo still over 4 MB without sending it", async () => {
    const action = vi.fn();
    const result = await uploadPhoto(photo(4 * 1024 * 1024 + 1), action);
    expect(result.ok).toBe(false);
    expect(action).not.toHaveBeenCalled();
  });

  it("turns a refused request into a message", async () => {
    const action = vi.fn(async () => {
      throw new Error("Body exceeded 1 MB limit.");
    });
    const result = await uploadPhoto(photo(1000), action);
    expect(result).toEqual({ ok: false, error: expect.stringContaining("did not upload") });
  });

  it("stops waiting on a stalled upload", async () => {
    vi.useFakeTimers();
    const action = vi.fn(() => new Promise<UploadResult>(() => {}));
    const pending = uploadPhoto(photo(1000), action);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await pending).toEqual({ ok: false, error: expect.stringContaining("taking too long") });
  });
});
