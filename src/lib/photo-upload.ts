// Browser side of every photo upload: product and Instagram photos in the admin,
// personalisation and review photos on the shop. A phone camera photo is often
// 3 to 6 MB, far over what a server action accepts (next.config.mjs), so it is
// shrunk here first. Without that the request was refused before our code ran
// and the button sat on "Uploading…" for good.

export type UploadResult = { ok: true; url: string } | { ok: false; error: string };

/** Longest side after shrinking. Well past the largest size the site shows. */
const MAX_EDGE = 2000;
const QUALITY = 0.85;
/** A photo already this small and within MAX_EDGE is sent as it is. */
const SMALL_ENOUGH_BYTES = 500 * 1024;
/** Matches MAX_IMAGE_BYTES in image-upload.ts, which the server checks again. */
const MAX_SEND_BYTES = 4 * 1024 * 1024;
/** Stop waiting after this, so a dropped connection ends in a message, not a spinner. */
const UPLOAD_TIMEOUT_MS = 60_000;

const TOO_LARGE = "That photo is too large. Please choose one under 4 MB.";
const FAILED = "The photo did not upload. Please check your connection and try again.";
const TIMED_OUT = "The upload is taking too long. Please check your connection and try again.";

function toBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, QUALITY));
}

/**
 * Resizes a photo to MAX_EDGE and re-encodes it as WebP, or JPEG where the
 * browser cannot write WebP. Hands back the original whenever shrinking is not
 * possible or not smaller, and the server's own checks decide from there.
 */
export async function shrinkPhoto(file: File): Promise<File> {
  // Redrawing a GIF keeps only its first frame.
  if (file.type === "image/gif" || typeof createImageBitmap !== "function") return file;

  let bitmap: ImageBitmap;
  try {
    // Applies the camera's rotation, so a portrait photo stays upright.
    bitmap = await createImageBitmap(file);
  } catch {
    // A format this browser cannot read, such as HEIC on a computer.
    return file;
  }

  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size <= SMALL_ENOUGH_BYTES) {
    bitmap.close();
    return file;
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    return file;
  }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  let blob = await toBlob(canvas, "image/webp");
  if (blob?.type !== "image/webp") {
    // Safari cannot write WebP and returns a PNG instead. JPEG has no
    // transparency, so paint white behind the photo before encoding it.
    context.globalCompositeOperation = "destination-over";
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    blob = await toBlob(canvas, "image/jpeg");
  }
  if (!blob || blob.size >= file.size) return file;

  const ext = blob.type === "image/webp" ? "webp" : "jpg";
  const name = `${file.name.replace(/\.[^.]*$/, "") || "photo"}.${ext}`;
  return new File([blob], name, { type: blob.type });
}

/**
 * Shrinks the photo and sends it to an upload server action as `file`, with
 * any `fields` alongside. Always settles with a result the form can show: a
 * refused request, a dropped connection and a stalled one all become a message.
 */
export async function uploadPhoto(
  file: File,
  action: (formData: FormData) => Promise<UploadResult>,
  fields: Record<string, string> = {},
): Promise<UploadResult> {
  const photo = await shrinkPhoto(file);
  if (photo.size > MAX_SEND_BYTES) return { ok: false, error: TOO_LARGE };

  const formData = new FormData();
  formData.append("file", photo);
  for (const [key, value] of Object.entries(fields)) formData.append(key, value);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<UploadResult>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, error: TIMED_OUT }), UPLOAD_TIMEOUT_MS);
  });
  try {
    return await Promise.race([action(formData), timeout]);
  } catch {
    return { ok: false, error: FAILED };
  } finally {
    clearTimeout(timer);
  }
}
