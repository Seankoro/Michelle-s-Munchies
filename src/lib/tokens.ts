import "server-only";
import { randomBytes } from "node:crypto";

/**
 * A random 32-char hex token, the one format used for tracking, recipient,
 * share, and unsubscribe links. One home so every link is minted the same way.
 */
export const newToken = (): string => randomBytes(16).toString("hex");
