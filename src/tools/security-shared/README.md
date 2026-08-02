# Client-side security engine

The shared scanner is an intentionally limited, deterministic
**YARA-compatible subset**. It is not libyara: the installed dependency tree
contains no viable libyara WebAssembly runtime.

It supports primitive metadata, tags, text/hex/regex strings, `ascii`, `wide`,
`nocase`, `fullword`, boolean references, `any/all/N of them`, `filesize`, and
little-endian `uint8/16/32` checks. It does not support YARA modules, imports,
includes, loops, external variables, wildcard sets, hex jumps/ranges, or full
libyara syntax and semantics.

All tools are static, client-only heuristic aids. They do not execute,
detonate, upload, or generate malware, and must not be treated as antivirus,
legal advice, or compliance certification. File and archive limits are
enforced to reduce browser resource exhaustion.
