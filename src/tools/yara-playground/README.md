# YARA Playground

This tool uses a client-side **YARA-compatible subset**, not libyara. No viable
libyara WebAssembly package is present in this project's installed dependencies.

Supported: rule names/tags, primitive metadata, text/hex/regex strings,
`ascii`, `wide`, `nocase`, boolean string references, `any/all/N of them`,
`filesize`, and little-endian `uint8/16/32(offset)` comparisons.

Not supported: imports/modules, includes, external variables, callbacks, loops,
anonymous/wildcard string sets, jumps/ranges in hex strings, PE/ELF helpers, and
the rest of the full YARA grammar. Rules should be validated with libyara before
production use.
