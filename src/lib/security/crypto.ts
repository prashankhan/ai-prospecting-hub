import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM envelope for provider credentials. The 32-byte key comes from the hosting
 * environment (CREDENTIALS_ENCRYPTION_KEY, base64) and is never stored in the database.
 * Format: v1.<iv>.<tag>.<ciphertext> (base64url segments).
 */
const VERSION = "v1";

export class EncryptionKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EncryptionKeyError";
  }
}

export function loadEncryptionKey(raw = process.env.CREDENTIALS_ENCRYPTION_KEY): Buffer {
  if (!raw) throw new EncryptionKeyError("CREDENTIALS_ENCRYPTION_KEY is not set.");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new EncryptionKeyError("CREDENTIALS_ENCRYPTION_KEY must be 32 bytes, base64-encoded.");
  return key;
}

export function hasEncryptionKey(): boolean {
  try {
    loadEncryptionKey();
    return true;
  } catch {
    return false;
  }
}

export function encryptSecret(plaintext: string, key = loadEncryptionKey()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(VERSION));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptSecret(envelope: string, key = loadEncryptionKey()): string {
  const [version, iv, tag, data] = envelope.split(".");
  if (version !== VERSION || !iv || !tag || !data) throw new Error("Unsupported credential format.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(VERSION));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

/** Non-reversible hint shown in the UI so admins can tell which key is stored. */
export function secretHint(secret: string): string {
  const trimmed = secret.trim();
  return trimmed.length <= 8 ? "••••" : `••••${trimmed.slice(-4)}`;
}

/** Removes anything that looks like a credential from error text before logging/storing. */
export function redactSecrets(text: string, secrets: string[] = []): string {
  let out = text;
  for (const s of secrets) if (s && s.length >= 6) out = out.split(s).join("[redacted]");
  return out
    .replace(/(key=)[^&\s"]+/gi, "$1[redacted]")
    .replace(/\b(sk-[a-z0-9-_]{8,}|AIza[0-9A-Za-z\-_]{20,}|sk-ant-[a-z0-9-_]{8,})\b/gi, "[redacted]")
    .replace(/(authorization:\s*bearer\s+)[^\s"]+/gi, "$1[redacted]")
    .slice(0, 1000);
}
