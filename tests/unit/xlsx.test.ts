import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseXlsxBuffer } from "../../src/main/data-service";
import { parseCsv } from "../../src/shared/csv";

describe("XLSX 导入解析", () => {
  it("首个工作表转 CSV 后表头与行数正确", () => {
    const buffer = readFileSync(path.join(__dirname, "..", "fixtures", "data.xlsx"));
    const text = parseXlsxBuffer(buffer);
    const { headers, rows } = parseCsv(text);
    expect(headers).toEqual(["x1", "x2", "y"]);
    expect(rows.length).toBe(11);
    expect(rows[0]).toEqual(["4", "3", "4.2"]);
  });
});
