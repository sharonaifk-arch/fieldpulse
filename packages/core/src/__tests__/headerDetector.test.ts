import { describe, expect, it } from "vitest";
import { detectHeaderRow } from "../excel/headerDetector.js";

describe("detectHeaderRow", () => {
  it("finds headers on row 2 under a merged meta-group row (BSC main FA sheet)", () => {
    const rows = [
      [null, null, null, null, null, null, null, null, "FA", null, null, "GFE  RVTF"],
      ["Sold To", "Ship To", "Hospital Name", "City", "Country", "Material Number", "Batch Number",
       "Qty Sent", "Qty to return (stated on VF)", "VF", "Date (VF received)", "2nd Notif Date"],
      ["54855", "54853", "CLINIQUE", "ABBEVILLE", "France", "M00558690", "38303878", 1, "", "", "", ""],
    ];
    const d = detectHeaderRow(rows);
    expect(d.rowIndex).toBe(1);
    expect(d.indexByKey["soldTo"]).toBe(0);
    expect(d.indexByKey["vf"]).toBe(9);
    expect(d.indexByKey["qtyToReturn"]).toBe(8);
  });

  it("finds headers on row 1 for MM sheets", () => {
    const rows = [
      ["Sold To", "Ship To", "Hospital Name", "User's Name", "Department", "Customer Address",
       "Zip Code", "City", "Country Name", "Ackn. Form", "Date (Form received)"],
      ["33103", "956483", "POLE SANTE", "x", "y", "z", "68003", "COLMAR", "France", 1, "25-Mar-26"],
    ];
    const d = detectHeaderRow(rows);
    expect(d.rowIndex).toBe(0);
    expect(d.indexByKey["acknForm"]).toBe(9);
    expect(d.indexByKey["formDate"]).toBe(10);
  });

  it("does not map 'Qty to return (stated on VF)' to the vf key", () => {
    const rows = [["Sold To", "Qty to return (stated on VF)", "VF"]];
    const d = detectHeaderRow(rows);
    expect(d.indexByKey["vf"]).toBe(2);
    expect(d.indexByKey["qtyToReturn"]).toBe(1);
  });

  it("returns -1 when no plausible header exists", () => {
    const rows = [
      ["hello", "world"],
      [1, 2, 3],
    ];
    expect(detectHeaderRow(rows).rowIndex).toBe(-1);
  });
});
