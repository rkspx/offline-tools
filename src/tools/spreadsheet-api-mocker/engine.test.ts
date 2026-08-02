import { describe, expect, it } from "vitest";
import { makeOpenApi, normalizeRoute, parseCsv, runMockRequest } from "./engine";

const rows = [
  { id: 1, name: "Red mug", price: 18, active: true },
  { id: 2, name: "Blue bowl", price: 24, active: false },
  { id: 3, name: "Red bowl", price: 12, active: true },
];

describe("spreadsheet API mocker engine", () => {
  it("parses typed CSV rows", () => {
    expect(parseCsv("id,active\n1,true")).toEqual([{ id: 1, active: true }]);
  });

  it("normalizes collection routes", () => {
    expect(normalizeRoute("api//products/")).toBe("/api/products");
  });

  it("filters, sorts, and paginates collections", () => {
    const result = runMockRequest(
      rows,
      { route: "/api/products", idField: "id" },
      "/api/products?name__contains=bowl&_sort=price&_order=desc&_page=1&_limit=1",
    );
    expect(result.status).toBe(200);
    expect(result.body).toEqual([rows[1]]);
    expect(result.headers["x-total-count"]).toBe("2");
  });

  it("looks up IDs and handles missing routes", () => {
    expect(runMockRequest(rows, { route: "/api/products", idField: "id" }, "/api/products/3").body).toEqual(rows[2]);
    expect(runMockRequest(rows, { route: "/api/products", idField: "id" }, "/api/other").status).toBe(404);
  });

  it("generates an OpenAPI-like document", () => {
    const output = makeOpenApi({ route: "/api/products", idField: "id", sheetName: "Products" }, rows);
    expect(output).toContain('"/api/products/{id}"');
    expect(output).toContain('"price"');
  });
});
