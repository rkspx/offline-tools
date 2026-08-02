# Spreadsheet API Mocker

Imports CSV/XLSX rows and simulates local GET collection and item requests. It supports equality/range/string filters, multi-field sorting, pagination, an in-page `mockFetch`, and OpenAPI-like JSON export.

It does not start an HTTP server or intercept unrelated application requests. POST, PUT, PATCH, DELETE, authentication, persistence, latency/failure simulation, and standards-complete OpenAPI generation are out of scope. Collection pages are capped at 500 rows.
