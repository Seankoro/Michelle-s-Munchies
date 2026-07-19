import "server-only";

/**
 * The only image types we accept for upload. SVG is deliberately excluded: it
 * can carry inline <script>, so an SVG served from a public storage bucket and
 * opened directly is a stored-XSS vector. Sticking to raster formats removes
 * that whole class. The value is the safe file extension for each type.
 */
const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

type ValidatedImage =
  | { ok: true; ext: string; contentType: string }
  | { ok: false; error: string };

/**
 * Validate an uploaded image against a strict allowlist. The safe extension and
 * content type come from the vetted MIME, never the client-supplied file name,
 * so a request can't smuggle in an ".svg" or a spoofed content type. Callers
 * must narrow `file` to a File first, then pass the validated `contentType` to
 * `.upload()` and build the path from `ext`.
 */
export function validateImageUpload(file: File): ValidatedImage {
  if (file.size === 0) return { ok: false, error: "No file provided." };
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, error: "Image must be under 5 MB." };
  const contentType = file.type.toLowerCase();
  const ext = ALLOWED_IMAGE_TYPES[contentType];
  if (!ext) {
    return { ok: false, error: "Please choose a JPEG, PNG, WEBP, or GIF image." };
  }
  return { ok: true, ext, contentType };
}
