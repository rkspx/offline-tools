export const VAULT_FORMAT = "minitools-secrets-vault";
export const VAULT_VERSION = 1;
export const DEFAULT_PBKDF2_ITERATIONS = 600_000;
export const DEFAULT_PASSWORD_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*()-_=+";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const ENTRY_STRING_KEYS = ["id", "title", "username", "password", "url", "notes", "createdAt", "updatedAt"] as const;

export type VaultEntry = {
  id: string;
  title: string;
  username: string;
  password: string;
  url: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

type VaultPayload = {
  entries: VaultEntry[];
  updatedAt: string;
};

export type VaultFile = {
  format: typeof VAULT_FORMAT;
  version: typeof VAULT_VERSION;
  kdf: {
    name: "PBKDF2";
    hash: "SHA-256";
    iterations: number;
    salt: string;
  };
  cipher: {
    name: "AES-256-GCM";
    iv: string;
  };
  ciphertext: string;
};

export type OpenedVault = {
  key: CryptoKey;
  entries: VaultEntry[];
};

export class VaultOpenError extends Error {
  constructor() {
    super("Unable to unlock this vault. The password is incorrect or the file is damaged.");
    this.name = "VaultOpenError";
  }
}

function cryptoApi(): Crypto {
  return globalThis.crypto;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const output = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) output[index] = binary.charCodeAt(index);
  return output;
}

function metadataFor(file: Pick<VaultFile, "format" | "version" | "kdf" | "cipher">): Uint8Array {
  return encoder.encode(JSON.stringify({
    format: file.format,
    version: file.version,
    kdf: file.kdf,
    cipher: file.cipher,
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function assertFile(value: unknown): asserts value is VaultFile {
  if (!isRecord(value)) throw new VaultOpenError();
  const file = value;
  const kdf = file.kdf;
  const cipher = file.cipher;
  if (
    file.format !== VAULT_FORMAT ||
    file.version !== VAULT_VERSION ||
    !isRecord(kdf) ||
    kdf.name !== "PBKDF2" ||
    kdf.hash !== "SHA-256" ||
    typeof kdf.iterations !== "number" ||
    !Number.isSafeInteger(kdf.iterations) ||
    kdf.iterations < 100_000 ||
    typeof kdf.salt !== "string" ||
    !isRecord(cipher) ||
    cipher.name !== "AES-256-GCM" ||
    typeof cipher.iv !== "string" ||
    typeof file.ciphertext !== "string"
  ) {
    throw new VaultOpenError();
  }
}

function assertEntries(value: unknown): asserts value is VaultPayload {
  if (!isRecord(value) || !Array.isArray(value.entries)) {
    throw new VaultOpenError();
  }
  for (const item of (value as VaultPayload).entries) {
    if (
      !isRecord(item) ||
      ENTRY_STRING_KEYS.some((key) => typeof item[key] !== "string")
    ) {
      throw new VaultOpenError();
    }
  }
}

export function parseVaultFile(input: string | Uint8Array): VaultFile {
  try {
    const text = typeof input === "string" ? input : decoder.decode(input);
    const parsed: unknown = JSON.parse(text);
    assertFile(parsed);
    const salt = base64ToBytes(parsed.kdf.salt);
    const iv = base64ToBytes(parsed.cipher.iv);
    const ciphertext = base64ToBytes(parsed.ciphertext);
    if (salt.length !== 16 || iv.length !== 12 || ciphertext.length < 17) throw new VaultOpenError();
    return parsed;
  } catch {
    throw new VaultOpenError();
  }
}

export async function deriveVaultKey(
  password: string,
  salt: Uint8Array,
  iterations = DEFAULT_PBKDF2_ITERATIONS,
): Promise<CryptoKey> {
  const api = cryptoApi();
  const passwordBytes = encoder.encode(password);
  try {
    const material = await api.subtle.importKey("raw", passwordBytes, "PBKDF2", false, ["deriveKey"]);
    return await api.subtle.deriveKey(
      { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  } finally {
    wipeBytes(passwordBytes);
  }
}

async function encryptWithKey(
  key: CryptoKey,
  entries: VaultEntry[],
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const api = cryptoApi();
  const iv = api.getRandomValues(new Uint8Array(12));
  const file: VaultFile = {
    format: VAULT_FORMAT,
    version: VAULT_VERSION,
    kdf: {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations,
      salt: bytesToBase64(salt),
    },
    cipher: { name: "AES-256-GCM", iv: bytesToBase64(iv) },
    ciphertext: "",
  };
  const plaintext = encoder.encode(JSON.stringify({ entries, updatedAt: new Date().toISOString() } satisfies VaultPayload));
  try {
    const encrypted = await api.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: iv as BufferSource,
        additionalData: metadataFor(file) as BufferSource,
        tagLength: 128,
      },
      key,
      plaintext,
    );
    file.ciphertext = bytesToBase64(new Uint8Array(encrypted));
    return encoder.encode(`${JSON.stringify(file, null, 2)}\n`);
  } finally {
    wipeBytes(plaintext);
    wipeBytes(iv);
  }
}

export async function createVault(
  password: string,
  entries: VaultEntry[] = [],
  iterations = DEFAULT_PBKDF2_ITERATIONS,
): Promise<{ key: CryptoKey; bytes: Uint8Array }> {
  if (password.length < 12) throw new Error("Use a master password with at least 12 characters.");
  if (!Number.isSafeInteger(iterations) || iterations < 100_000) throw new Error("PBKDF2 iterations must be at least 100,000.");
  const salt = cryptoApi().getRandomValues(new Uint8Array(16));
  try {
    const key = await deriveVaultKey(password, salt, iterations);
    return { key, bytes: await encryptWithKey(key, entries, salt, iterations) };
  } finally {
    wipeBytes(salt);
  }
}

export async function unlockVault(input: string | Uint8Array, password: string): Promise<OpenedVault> {
  try {
    const file = parseVaultFile(input);
    const salt = base64ToBytes(file.kdf.salt);
    const iv = base64ToBytes(file.cipher.iv);
    const ciphertext = base64ToBytes(file.ciphertext);
    try {
      const key = await deriveVaultKey(password, salt, file.kdf.iterations);
      const decrypted = await cryptoApi().subtle.decrypt(
        {
          name: "AES-GCM",
          iv: iv as BufferSource,
          additionalData: metadataFor(file) as BufferSource,
          tagLength: 128,
        },
        key,
        ciphertext as BufferSource,
      );
      const plaintext = new Uint8Array(decrypted);
      try {
        const payload: unknown = JSON.parse(decoder.decode(plaintext));
        assertEntries(payload);
        return { key, entries: payload.entries };
      } finally {
        wipeBytes(plaintext);
      }
    } finally {
      wipeBytes(salt);
      wipeBytes(iv);
      wipeBytes(ciphertext);
    }
  } catch {
    throw new VaultOpenError();
  }
}

export async function saveVault(key: CryptoKey, previousFile: string | Uint8Array, entries: VaultEntry[]): Promise<Uint8Array> {
  const file = parseVaultFile(previousFile);
  const salt = base64ToBytes(file.kdf.salt);
  try {
    return await encryptWithKey(key, entries, salt, file.kdf.iterations);
  } finally {
    wipeBytes(salt);
  }
}

export function generatePassword(length = 24, alphabet = DEFAULT_PASSWORD_ALPHABET, api: Pick<Crypto, "getRandomValues"> = cryptoApi()): string {
  if (!Number.isSafeInteger(length) || length < 1 || length > 1024) throw new Error("Password length must be from 1 to 1024.");
  const characters = Array.from(alphabet);
  if (characters.length < 2 || characters.length > 256) throw new Error("Alphabet must contain from 2 to 256 characters.");
  const limit = Math.floor(256 / characters.length) * characters.length;
  const output: string[] = [];
  const random = new Uint8Array(Math.max(32, length * 2));
  try {
    while (output.length < length) {
      api.getRandomValues(random);
      for (const byte of random) {
        if (byte < limit) output.push(characters[byte % characters.length] ?? "");
        if (output.length === length) break;
      }
    }
    return output.join("");
  } finally {
    wipeBytes(random);
  }
}

export function wipeBytes(bytes: Uint8Array): void {
  bytes.fill(0);
}

export function makeEntry(values: Pick<VaultEntry, "title" | "username" | "password" | "url" | "notes">): VaultEntry {
  const now = new Date().toISOString();
  return { ...values, id: cryptoApi().randomUUID(), createdAt: now, updatedAt: now };
}

type StorageManagerWithDirectory = {
  getDirectory?: () => Promise<FileSystemDirectoryHandle>;
};

export function supportsOpfs(): boolean {
  return typeof navigator !== "undefined" && typeof (navigator.storage as StorageManagerWithDirectory | undefined)?.getDirectory === "function";
}

export async function saveVaultToOpfs(bytes: Uint8Array, filename = "secrets.vault.json"): Promise<void> {
  const storage = navigator.storage as StorageManagerWithDirectory;
  if (!storage.getDirectory) throw new Error("Local browser storage is not supported.");
  const root = await storage.getDirectory();
  const handle = await root.getFileHandle(filename, { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(bytes as unknown as FileSystemWriteChunkType);
  } finally {
    await writable.close();
  }
}

export async function loadVaultFromOpfs(filename = "secrets.vault.json"): Promise<Uint8Array | null> {
  const storage = navigator.storage as StorageManagerWithDirectory;
  if (!storage.getDirectory) return null;
  try {
    const root = await storage.getDirectory();
    const handle = await root.getFileHandle(filename);
    return new Uint8Array(await (await handle.getFile()).arrayBuffer());
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") return null;
    throw error;
  }
}
