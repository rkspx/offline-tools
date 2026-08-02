# Secrets Vault

Creates a portable JSON vault encrypted with AES-GCM and a PBKDF2-derived key (600,000 iterations). It supports entry editing, password generation, file import/export, locking, and optional OPFS persistence.

**This implementation has not been independently security-audited and is not a replacement for an audited password manager.** A forgotten master password cannot be recovered. Browser extensions, page compromise, or a compromised device can expose unlocked data; export a backup before clearing site storage.
