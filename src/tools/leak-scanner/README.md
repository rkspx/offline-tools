# Secret and PII Scanner

Scans pasted text, local text files, and bounded ZIP entries for built-in credential/PII patterns, entropy signals, and user-supplied regular expressions. Findings are masked and reports export locally.

Detection is heuristic and can miss encoded, split, novel, or contextual secrets while flagging benign values. ZIP size/file-count limits prevent exhaustive archive analysis. Results are not a compliance certification.
