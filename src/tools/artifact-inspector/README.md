# Artifact Inspector

Computes SHA-256, produces bounded hex/text previews, and applies curated static YARA-compatible rules to local files without executing them. Reports export as JSON or HTML.

This is static heuristic triage, not sandboxing, malware detonation, or antivirus. Rules use the project's limited browser subset rather than libyara and can produce false positives or negatives.
