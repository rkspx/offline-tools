import {
  ArrowClockwiseIcon,
  ClipboardIcon,
  DownloadSimpleIcon,
  EyeIcon,
  EyeSlashIcon,
  FileArrowUpIcon,
  FloppyDiskIcon,
  KeyIcon,
  LockIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  ShieldWarningIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import { type SyntheticEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  generatePassword,
  loadVaultFromOpfs,
  makeEntry,
  parseVaultFile,
  saveVault,
  saveVaultToOpfs,
  supportsOpfs,
  unlockVault,
  createVault,
  type VaultEntry,
} from "./engine";
import "./styles.css";

const AUTO_LOCK_MS = 5 * 60 * 1000;
const CLIPBOARD_CLEAR_MS = 30 * 1000;

type Notice = { kind: "error" | "info"; message: string } | null;

const EMPTY_ENTRY = {
  title: "",
  username: "",
  password: "",
  url: "",
  notes: "",
};

function downloadVault(bytes: Uint8Array) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `secrets-${new Date().toISOString().slice(0, 10)}.vault.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function matchesSearch(entry: VaultEntry, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  return !needle || [entry.title, entry.username, entry.url, entry.notes]
    .some((value) => value.toLocaleLowerCase().includes(needle));
}

function formValue(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === "string" ? value : "";
}

export default function SecretsVault() {
  const importInput = useRef<HTMLInputElement>(null);
  const createPassword = useRef<HTMLInputElement>(null);
  const createConfirm = useRef<HTMLInputElement>(null);
  const unlockPassword = useRef<HTMLInputElement>(null);
  const generatedPassword = useRef<HTMLInputElement>(null);
  const keyRef = useRef<CryptoKey | null>(null);
  const clipboardTimer = useRef<number | null>(null);
  const [vaultBytes, setVaultBytes] = useState<Uint8Array | null>(null);
  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [unlocked, setUnlocked] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<VaultEntry | "new" | null>(null);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const opfsAvailable = supportsOpfs();

  const lock = useCallback((message?: string) => {
    keyRef.current = null;
    setEntries((current) => {
      current.forEach((entry) => Object.assign(entry, EMPTY_ENTRY));
      return [];
    });
    setUnlocked(false);
    setEditing(null);
    setQuery("");
    setRevealed(new Set());
    setDirty(false);
    if (message) setNotice({ kind: "info", message });
  }, []);

  useEffect(() => {
    if (!unlocked) return;
    let timer = window.setTimeout(() => lock("Vault locked after 5 minutes of inactivity."), AUTO_LOCK_MS);
    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => lock("Vault locked after 5 minutes of inactivity."), AUTO_LOCK_MS);
    };
    const events: (keyof DocumentEventMap)[] = ["pointerdown", "keydown"];
    events.forEach((event) => document.addEventListener(event, reset, { passive: true }));
    return () => {
      window.clearTimeout(timer);
      events.forEach((event) => document.removeEventListener(event, reset));
    };
  }, [lock, unlocked]);

  useEffect(() => () => {
    keyRef.current = null;
    if (clipboardTimer.current) window.clearTimeout(clipboardTimer.current);
  }, []);

  const visibleEntries = useMemo(
    () => entries.filter((entry) => matchesSearch(entry, query)).sort((a, b) => a.title.localeCompare(b.title)),
    [entries, query],
  );

  async function handleCreate(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const password = createPassword.current?.value ?? "";
    const confirm = createConfirm.current?.value ?? "";
    setNotice(null);
    if (password !== confirm) {
      setNotice({ kind: "error", message: "Master passwords do not match." });
      return;
    }
    setBusy(true);
    try {
      const created = await createVault(password);
      keyRef.current = created.key;
      setVaultBytes(created.bytes);
      setEntries([]);
      setUnlocked(true);
      setDirty(false);
      if (createPassword.current) createPassword.current.value = "";
      if (createConfirm.current) createConfirm.current.value = "";
      setNotice({ kind: "info", message: "Vault created. Export a backup or save the encrypted file locally." });
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "Could not create the vault." });
    } finally {
      setBusy(false);
    }
  }

  async function handleUnlock(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    if (!vaultBytes) return;
    const password = unlockPassword.current?.value ?? "";
    setBusy(true);
    setNotice(null);
    try {
      const opened = await unlockVault(vaultBytes, password);
      keyRef.current = opened.key;
      setEntries(opened.entries);
      setUnlocked(true);
      setDirty(false);
      if (unlockPassword.current) unlockPassword.current.value = "";
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "Unable to unlock this vault." });
    } finally {
      if (unlockPassword.current) unlockPassword.current.value = "";
      setBusy(false);
    }
  }

  async function importFile(file?: File) {
    if (!file) return;
    setBusy(true);
    setNotice(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      parseVaultFile(bytes);
      lock();
      setVaultBytes(bytes);
      setNotice({ kind: "info", message: `Loaded ${file.name}. Enter its master password to unlock.` });
    } catch {
      setNotice({ kind: "error", message: "Unable to open this vault. The password is incorrect or the file is damaged." });
    } finally {
      setBusy(false);
    }
  }

  async function loadLocal() {
    setBusy(true);
    setNotice(null);
    try {
      const bytes = await loadVaultFromOpfs();
      if (!bytes) {
        setNotice({ kind: "info", message: "No locally saved vault was found in this browser." });
        return;
      }
      lock();
      setVaultBytes(bytes);
      setNotice({ kind: "info", message: "Encrypted local vault loaded. Enter its master password." });
    } catch {
      setNotice({ kind: "error", message: "The locally saved vault could not be read." });
    } finally {
      setBusy(false);
    }
  }

  async function encryptCurrent(saveLocal: boolean) {
    if (!vaultBytes || !keyRef.current) return;
    setBusy(true);
    setNotice(null);
    try {
      const next = await saveVault(keyRef.current, vaultBytes, entries);
      setVaultBytes(next);
      setDirty(false);
      if (saveLocal) {
        await saveVaultToOpfs(next);
        setNotice({ kind: "info", message: "Encrypted vault saved in this browser using OPFS." });
      } else {
        setNotice({ kind: "info", message: "Changes encrypted with a fresh random IV." });
      }
    } catch {
      setNotice({ kind: "error", message: "Could not encrypt and save these changes." });
    } finally {
      setBusy(false);
    }
  }

  function submitEntry(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const values = {
      title: formValue(data, "title").trim(),
      username: formValue(data, "username"),
      password: formValue(data, "password"),
      url: formValue(data, "url").trim(),
      notes: formValue(data, "notes"),
    };
    if (!values.title) {
      setNotice({ kind: "error", message: "Entry title is required." });
      return;
    }
    if (editing === "new") {
      setEntries((current) => [...current, makeEntry(values)]);
    } else if (editing) {
      const now = new Date().toISOString();
      setEntries((current) => current.map((entry) => entry.id === editing.id ? { ...entry, ...values, updatedAt: now } : entry));
    }
    event.currentTarget.reset();
    setEditing(null);
    setDirty(true);
    setNotice({ kind: "info", message: "Entry changed in memory. Save to encrypt it." });
  }

  function deleteEntry(entry: VaultEntry) {
    if (!window.confirm(`Delete "${entry.title}"?`)) return;
    setEntries((current) => current.filter((item) => item.id !== entry.id));
    setEditing(null);
    setDirty(true);
  }

  async function copySecret(value: string, label: string) {
    setNotice(null);
    try {
      await navigator.clipboard.writeText(value);
      if (clipboardTimer.current) window.clearTimeout(clipboardTimer.current);
      clipboardTimer.current = window.setTimeout(() => {
        void navigator.clipboard.readText()
          .then((current) => current === value ? navigator.clipboard.writeText("") : undefined)
          .catch(() => undefined);
      }, CLIPBOARD_CLEAR_MS);
      setNotice({ kind: "info", message: `${label} copied. This app will try to clear it after 30 seconds.` });
    } catch {
      setNotice({ kind: "error", message: "Clipboard access was denied. Browser and clipboard-manager history may retain copied values." });
    }
  }

  const editingValues = editing === "new" || !editing ? EMPTY_ENTRY : editing;

  return (
    <div className="sv-app">
      <header className="sv-header">
        <div className="sv-brand">
          <span className="sv-mark"><KeyIcon size={22} weight="duotone" aria-hidden /></span>
          <div><strong>Secrets Vault</strong><span>Encrypted entirely in this browser</span></div>
        </div>
        {unlocked && (
          <div className="sv-header-actions">
            <span className={dirty ? "sv-unsaved" : "sv-saved"}>{dirty ? "Unsaved changes" : "Encrypted state current"}</span>
            <button type="button" className="sv-button sv-button-quiet" onClick={() => lock()}>
              <LockIcon size={17} aria-hidden /> Lock
            </button>
          </div>
        )}
      </header>

      <aside className="sv-caution">
        <ShieldWarningIcon size={20} aria-hidden />
        <div>
          <strong>Security notice</strong>
          <span>This browser app has not been independently audited. Clipboard clearing is best effort and cannot clear clipboard-manager or operating-system history.</span>
        </div>
      </aside>

      {notice && <div className={`sv-notice sv-notice-${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>{notice.message}</div>}

      {!vaultBytes ? (
        <main className="sv-start">
          <section className="sv-create-panel">
            <div className="sv-section-heading">
              <span>Create a vault</span>
              <h2>Start with one master password</h2>
              <p>It is never stored. Losing it means the encrypted vault cannot be recovered.</p>
            </div>
            <form onSubmit={(event) => void handleCreate(event)}>
              <label>Master password<input ref={createPassword} type="password" minLength={12} autoComplete="new-password" required /></label>
              <label>Confirm password<input ref={createConfirm} type="password" minLength={12} autoComplete="new-password" required /></label>
              <button className="sv-button sv-button-primary" type="submit" disabled={busy}>
                <KeyIcon size={18} aria-hidden /> {busy ? "Deriving key..." : "Create encrypted vault"}
              </button>
            </form>
          </section>
          <section className="sv-open-panel">
            <FileArrowUpIcon size={34} weight="duotone" aria-hidden />
            <h2>Open an existing vault</h2>
            <p>Import one encrypted vault file. Nothing is uploaded.</p>
            <button className="sv-button" type="button" disabled={busy} onClick={() => importInput.current?.click()}>Choose vault file</button>
            {opfsAvailable && <button className="sv-button sv-button-quiet" type="button" disabled={busy} onClick={() => void loadLocal()}>Load browser-saved vault</button>}
          </section>
        </main>
      ) : !unlocked ? (
        <main className="sv-unlock">
          <div className="sv-lock-illustration"><LockIcon size={32} weight="duotone" aria-hidden /></div>
          <h2>Vault locked</h2>
          <p>Wrong passwords and damaged files return the same error to avoid revealing which condition occurred.</p>
          <form onSubmit={(event) => void handleUnlock(event)}>
            <label>Master password<input ref={unlockPassword} type="password" autoComplete="current-password" autoFocus required /></label>
            <button className="sv-button sv-button-primary" type="submit" disabled={busy}>{busy ? "Unlocking..." : "Unlock vault"}</button>
          </form>
          <div className="sv-unlock-actions">
            <button className="sv-button sv-button-quiet" type="button" onClick={() => importInput.current?.click()}>Choose another file</button>
            <button className="sv-button sv-button-quiet" type="button" onClick={() => { setVaultBytes(null); setNotice(null); }}>Create new</button>
          </div>
        </main>
      ) : (
        <main className="sv-workspace">
          <section className="sv-toolbar">
            <label className="sv-search">
              <MagnifyingGlassIcon size={17} aria-hidden />
              <span className="visually-hidden">Search entries</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search title, username, URL, or notes" />
            </label>
            <button className="sv-button sv-button-primary" type="button" onClick={() => setEditing("new")}><PlusIcon size={17} aria-hidden /> Add entry</button>
          </section>

          <div className="sv-content">
            <section className="sv-list" aria-label="Vault entries">
              <header><strong>{visibleEntries.length}</strong><span>{query ? "matching entries" : "vault entries"}</span></header>
              {visibleEntries.length ? visibleEntries.map((entry) => (
                <article key={entry.id} className="sv-entry">
                  <button className="sv-entry-main" type="button" onClick={() => setEditing(entry)}>
                    <span className="sv-entry-icon">{entry.title.slice(0, 1).toLocaleUpperCase()}</span>
                    <span><strong>{entry.title}</strong><small>{entry.username || entry.url || "No account details"}</small></span>
                  </button>
                  <div className="sv-secret">
                    <code>{revealed.has(entry.id) ? entry.password : entry.password ? "••••••••••••" : "No password"}</code>
                    {entry.password && (
                      <>
                        <button type="button" aria-label={revealed.has(entry.id) ? "Hide password" : "Reveal password"} onClick={() => setRevealed((current) => {
                          const next = new Set(current);
                          if (next.has(entry.id)) next.delete(entry.id); else next.add(entry.id);
                          return next;
                        })}>{revealed.has(entry.id) ? <EyeSlashIcon size={17} aria-hidden /> : <EyeIcon size={17} aria-hidden />}</button>
                        <button type="button" aria-label="Copy password" onClick={() => void copySecret(entry.password, "Password")}><ClipboardIcon size={17} aria-hidden /></button>
                      </>
                    )}
                  </div>
                </article>
              )) : (
                <div className="sv-empty">
                  <KeyIcon size={30} weight="duotone" aria-hidden />
                  <strong>{query ? "No matching entries" : "Your vault is empty"}</strong>
                  <span>{query ? "Try a different search." : "Add a login, secure note, or other secret."}</span>
                </div>
              )}
            </section>

            <aside className="sv-side">
              <section>
                <h3>Encrypted file</h3>
                <p>Saving creates a new random 96-bit IV. Export after changes to keep an external backup current.</p>
                <button className="sv-button" type="button" disabled={busy || !dirty} onClick={() => void encryptCurrent(false)}><FloppyDiskIcon size={17} aria-hidden /> Encrypt changes</button>
                <button className="sv-button" type="button" disabled={busy || dirty} onClick={() => downloadVault(vaultBytes)}><DownloadSimpleIcon size={17} aria-hidden /> Export file</button>
                {opfsAvailable && <button className="sv-button sv-button-quiet" type="button" disabled={busy} onClick={() => void encryptCurrent(true)}><FloppyDiskIcon size={17} aria-hidden /> Save in browser</button>}
              </section>
              <section>
                <h3>Password generator</h3>
                <p>Uses cryptographic random bytes with rejection sampling to avoid modulo bias.</p>
                <div className="sv-generator">
                  <input ref={generatedPassword} aria-label="Generated password" readOnly defaultValue={generatePassword()} />
                  <button type="button" aria-label="Generate another password" onClick={() => {
                    if (generatedPassword.current) generatedPassword.current.value = generatePassword();
                  }}><ArrowClockwiseIcon size={17} aria-hidden /></button>
                </div>
                <button className="sv-button sv-button-quiet" type="button" onClick={() => void copySecret(generatedPassword.current?.value ?? "", "Generated password")}><ClipboardIcon size={17} aria-hidden /> Copy generated password</button>
              </section>
            </aside>
          </div>
        </main>
      )}

      <input
        ref={importInput}
        className="visually-hidden"
        type="file"
        accept=".json,.vault,application/json"
        onChange={(event) => {
          void importFile(event.currentTarget.files?.[0]);
          event.currentTarget.value = "";
        }}
      />

      {editing && (
        <div className="sv-dialog-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setEditing(null);
        }}>
          <section className="sv-dialog" role="dialog" aria-modal="true" aria-labelledby="sv-entry-title">
            <header>
              <div><span>Vault entry</span><h2 id="sv-entry-title">{editing === "new" ? "Add a secret" : "Edit secret"}</h2></div>
              <button type="button" aria-label="Close editor" onClick={() => setEditing(null)}><XIcon size={19} aria-hidden /></button>
            </header>
            <form onSubmit={submitEntry}>
              <label>Title<input name="title" defaultValue={editingValues.title} autoComplete="off" autoFocus required /></label>
              <label>Username or email<input name="username" defaultValue={editingValues.username} autoComplete="off" /></label>
              <label>Password
                <span className="sv-password-field">
                  <input name="password" defaultValue={editingValues.password} autoComplete="off" />
                  <button type="button" onClick={(event) => {
                    const input = event.currentTarget.previousElementSibling as HTMLInputElement | null;
                    if (input) input.value = generatePassword();
                  }}><ArrowClockwiseIcon size={16} aria-hidden /> Generate</button>
                </span>
              </label>
              <label>Website<input name="url" type="url" defaultValue={editingValues.url} autoComplete="off" /></label>
              <label>Notes<textarea name="notes" rows={4} defaultValue={editingValues.notes} /></label>
              <footer>
                {editing !== "new" && <button className="sv-button sv-button-danger" type="button" onClick={() => deleteEntry(editing)}><TrashIcon size={17} aria-hidden /> Delete</button>}
                <button className="sv-button sv-button-quiet" type="button" onClick={() => setEditing(null)}>Cancel</button>
                <button className="sv-button sv-button-primary" type="submit">Save entry</button>
              </footer>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
