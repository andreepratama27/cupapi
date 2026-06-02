import { FeedEntry } from "./tracker";

export const SYNC_CODE_STORAGE_KEY = "cupapi:sync-code";
const PANTRY_BASE = "https://getpantry.cloud/apiv1/pantry";

export class SyncError extends Error {
  constructor(
    message: string,
    public readonly kind:
      | "not-configured"
      | "not-found"
      | "network"
      | "decrypt"
      | "invalid-code",
  ) {
    super(message);
    this.name = "SyncError";
  }
}

type SyncPayload = {
  v: 1;
  updatedAt: string;
  iv: string;
  ciphertext: string;
};

function getPantryId(): string {
  const id = process.env.NEXT_PUBLIC_PANTRY_ID;
  if (!id) {
    throw new SyncError(
      "Sync is not configured. Set NEXT_PUBLIC_PANTRY_ID in .env.local.",
      "not-configured",
    );
  }
  return id;
}

export function isSyncConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_PANTRY_ID);
}

export function generateSyncCode(): string {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return String(buffer[0] % 1_000_000).padStart(6, "0");
}

export function isValidSyncCode(value: string): boolean {
  return /^\d{6}$/.test(value);
}

function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (let index = 0; index < view.length; index += 1) {
    binary += String.fromCharCode(view[index]);
  }
  return btoa(binary);
}

function fromBase64(value: string): ArrayBuffer {
  const binary = atob(value);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return buffer;
}

async function sha256(value: string): Promise<ArrayBuffer> {
  const bytes = new TextEncoder().encode(value);
  return crypto.subtle.digest("SHA-256", bytes);
}

async function deriveBasketName(code: string): Promise<string> {
  const digest = await sha256(`cupapi:basket:${code}`);
  return `cupapi-${toBase64(digest).replace(/[^a-zA-Z0-9]/g, "").slice(0, 24)}`;
}

async function deriveEncryptionKey(code: string): Promise<CryptoKey> {
  const digest = await sha256(`cupapi:key:${code}`);
  return crypto.subtle.importKey(
    "raw",
    digest,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encryptFeeds(feeds: FeedEntry[], code: string): Promise<SyncPayload> {
  const key = await deriveEncryptionKey(code);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify({ feeds }));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plaintext,
  );
  return {
    v: 1,
    updatedAt: new Date().toISOString(),
    iv: toBase64(iv),
    ciphertext: toBase64(ciphertext),
  };
}

async function decryptFeeds(payload: SyncPayload, code: string): Promise<FeedEntry[]> {
  const key = await deriveEncryptionKey(code);
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(payload.iv) },
      key,
      fromBase64(payload.ciphertext),
    );
    const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as {
      feeds?: unknown;
    };
    if (!Array.isArray(parsed.feeds)) {
      throw new SyncError("Data sinkronisasi rusak.", "decrypt");
    }
    return parsed.feeds as FeedEntry[];
  } catch (error) {
    if (error instanceof SyncError) throw error;
    throw new SyncError("Kode salah atau data tidak dapat dibaca.", "decrypt");
  }
}

export async function pushFeeds(code: string, feeds: FeedEntry[]): Promise<void> {
  if (!isValidSyncCode(code)) {
    throw new SyncError("Kode sinkronisasi harus 6 digit.", "invalid-code");
  }
  const pantryId = getPantryId();
  const basketName = await deriveBasketName(code);
  const payload = await encryptFeeds(feeds, code);

  let response: Response;
  try {
    response = await fetch(`${PANTRY_BASE}/${pantryId}/basket/${basketName}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new SyncError("Gagal terhubung. Periksa koneksi internet.", "network");
  }

  if (!response.ok) {
    throw new SyncError(
      `Gagal menyimpan log (HTTP ${response.status}).`,
      "network",
    );
  }
}

export async function pullFeeds(code: string): Promise<FeedEntry[]> {
  if (!isValidSyncCode(code)) {
    throw new SyncError("Kode sinkronisasi harus 6 digit.", "invalid-code");
  }
  const pantryId = getPantryId();
  const basketName = await deriveBasketName(code);

  let response: Response;
  try {
    response = await fetch(`${PANTRY_BASE}/${pantryId}/basket/${basketName}`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    throw new SyncError("Gagal terhubung. Periksa koneksi internet.", "network");
  }

  if (response.status === 400 || response.status === 404) {
    throw new SyncError("Kode tidak ditemukan.", "not-found");
  }
  if (!response.ok) {
    throw new SyncError(
      `Gagal memuat log (HTTP ${response.status}).`,
      "network",
    );
  }

  const raw = (await response.json()) as Partial<SyncPayload>;
  if (
    raw.v !== 1 ||
    typeof raw.iv !== "string" ||
    typeof raw.ciphertext !== "string"
  ) {
    throw new SyncError("Format data sinkronisasi tidak dikenali.", "decrypt");
  }
  return decryptFeeds(raw as SyncPayload, code);
}
