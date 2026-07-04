import { describe, expect, it } from "vitest";
import {
  parseDate, parseFormValue, parseQty, normalizeSoldTo, excelSerialToIso,
} from "../excel/valueParsers.js";

describe("parseQty", () => {
  it("parses numbers and numeric strings", () => {
    expect(parseQty(3).value).toBe(3);
    expect(parseQty("2").value).toBe(2);
    expect(parseQty("1,5").value).toBe(1.5);
  });
  it("returns null for blank and N/A placeholders", () => {
    for (const v of ["", null, undefined, "N/A", "n/a", "NI", "N/I", "-"]) {
      expect(parseQty(v).value).toBeNull();
      expect(parseQty(v).suspicious).toBeNull();
    }
  });
  it("flags free text as suspicious", () => {
    const q = parseQty("To scrap");
    expect(q.value).toBeNull();
    expect(q.suspicious).toBe("To scrap");
  });
});

describe("parseDate", () => {
  it("parses d-MMM-yy and d-MMM-yyyy", () => {
    expect(parseDate("25-Mar-26")).toBe("2026-03-25");
    expect(parseDate("24-FEB-2026")).toBe("2026-02-24");
    expect(parseDate("3-Nov-16")).toBe("2016-11-03");
  });
  it("parses EU dd/mm/yyyy first, falls back to US m/d/yy", () => {
    expect(parseDate("03/11/2016")).toBe("2016-11-03"); // day-first
    expect(parseDate("3/25/26")).toBe("2026-03-25"); // 25 can't be a month -> US
  });
  it("parses Excel serial numbers", () => {
    expect(excelSerialToIso(45000)).toBe("2023-03-15");
    expect(parseDate(45000)).toBe("2023-03-15");
  });
  it("returns null for junk", () => {
    expect(parseDate("N/A")).toBeNull();
    expect(parseDate("hello")).toBeNull();
    expect(parseDate("")).toBeNull();
  });
});

describe("parseFormValue", () => {
  it("maps values to statuses", () => {
    expect(parseFormValue(1)).toBe("received");
    expect(parseFormValue("1")).toBe("received");
    expect(parseFormValue("GFE")).toBe("gfe");
    expect(parseFormValue("gfe")).toBe("gfe");
    expect(parseFormValue("")).toBe("open");
    expect(parseFormValue(null)).toBe("open");
    expect(parseFormValue("N/A")).toBe("na");
    expect(parseFormValue("maybe")).toBe("review");
  });
});

describe("normalizeSoldTo", () => {
  it("strips leading zeros so 0000060096 groups with 60096", () => {
    expect(normalizeSoldTo("0000060096")).toBe("60096");
    expect(normalizeSoldTo("60096")).toBe("60096");
    expect(normalizeSoldTo(" 33103 ")).toBe("33103");
  });
});
