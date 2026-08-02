import { describe, expect, it } from "vitest";
import {
  DEFAULT_PBKDF2_ITERATIONS,
  VAULT_FORMAT,
  VAULT_VERSION,
  VaultOpenError,
  createVault,
  generatePassword,
  makeEntry,
  parseVaultFile,
  saveVault,
  unlockVault,
} from "./engine";

const TEST_ITERATIONS = 100_000;

describe("secrets vault crypto engine", () => {
  it("uses a high production PBKDF2 work factor", () => {
    expect(DEFAULT_PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(600_000);
  });

  it("round-trips entries without exposing plaintext in the file", async () => {
    const entry = makeEntry({
      title: "Mail",
      username: "person@example.test",
      password: "correct horse battery staple",
      url: "https://example.test",
      notes: "recovery value",
    });
    const created = await createVault("a long master password", [entry], TEST_ITERATIONS);
    const text = new TextDecoder().decode(created.bytes);
    const file = parseVaultFile(text);

    expect(file).toMatchObject({
      format: VAULT_FORMAT,
      version: VAULT_VERSION,
      kdf: { name: "PBKDF2", hash: "SHA-256", iterations: TEST_ITERATIONS },
      cipher: { name: "AES-256-GCM" },
    });
    expect(text).not.toContain(entry.password);
    expect(text).not.toContain(entry.username);

    const opened = await unlockVault(created.bytes, "a long master password");
    expect(opened.entries).toEqual([entry]);
  });

  it("uses random salts for new files and a fresh IV for every save", async () => {
    const first = await createVault("a long master password", [], TEST_ITERATIONS);
    const second = await createVault("a long master password", [], TEST_ITERATIONS);
    expect(parseVaultFile(first.bytes).kdf.salt).not.toBe(parseVaultFile(second.bytes).kdf.salt);

    const savedOnce = await saveVault(first.key, first.bytes, []);
    const savedTwice = await saveVault(first.key, savedOnce, []);
    expect(parseVaultFile(savedOnce).cipher.iv).not.toBe(parseVaultFile(savedTwice).cipher.iv);
  });

  it("returns the same error for a wrong password and authenticated-data corruption", async () => {
    const created = await createVault("a long master password", [], TEST_ITERATIONS);
    const file = parseVaultFile(created.bytes);
    file.ciphertext = `${file.ciphertext.slice(0, -2)}AA`;
    const corrupted = JSON.stringify(file);

    const wrongPassword = await unlockVault(created.bytes, "wrong password").catch((error: unknown) => error);
    const damagedFile = await unlockVault(corrupted, "a long master password").catch((error: unknown) => error);

    expect(wrongPassword).toBeInstanceOf(VaultOpenError);
    expect(damagedFile).toBeInstanceOf(VaultOpenError);
    expect((wrongPassword as Error).message).toBe((damagedFile as Error).message);
  });

  it("rejects unsupported or malformed vault files", () => {
    expect(() => parseVaultFile('{"version":99}')).toThrow(VaultOpenError);
    expect(() => parseVaultFile("not-json")).toThrow(VaultOpenError);
  });

  it("uses rejection sampling when generating passwords", () => {
    const chunks = [
      new Uint8Array([255, 4, 5, 6]),
      new Uint8Array([7, 8, 9, 10]),
    ];
    let call = 0;
    const random: Pick<Crypto, "getRandomValues"> = {
      getRandomValues<T extends ArrayBufferView>(target: T): T {
        const bytes = target as unknown as Uint8Array;
        bytes.fill(255);
        bytes.set(chunks[Math.min(call, chunks.length - 1)] ?? []);
        call += 1;
        return target;
      },
    };
    const password = generatePassword(4, "abcde", random);
    expect(password).toBe("eabc");
    expect(call).toBeGreaterThan(1);
  });
});
