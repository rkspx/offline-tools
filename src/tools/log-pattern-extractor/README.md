# Log Pattern Extractor

Applies built-in and custom regular expressions to local line-oriented log text, previews extracted fields, and exports normalized CSV or JSON.

It is a heuristic extractor rather than a streaming parser or observability backend. Multiline events and unsupported formats may be split or missed, and pathological custom regular expressions can block the page.
