import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createReadTool } from "../../dist/tools/read.js";
import { makeToolCtx, makeWorkspace, textOf } from "../helpers.js";

function write(path: string, content: string | Buffer): void {
  writeFileSync(path, content);
}

const PNG_1PX = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

const MINIMAL_PDF = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>
endobj
4 0 obj
<< /Length 44 >>
stream
BT /F1 12 Tf 100 700 Td (Hello PDF) Tj ET
endstream
endobj
trailer
<< >>
`;

const NOTEBOOK = JSON.stringify({
  cells: [
    { cell_type: "code", source: ["print(1)\n"], outputs: [{ text: "1\n" }] },
    { cell_type: "markdown", source: ["# Title"], outputs: [] },
  ],
});

describe("T-T3: Read", () => {
  it("reads text with line numbers and respects offset/limit", async () => {
    const ws = makeWorkspace();
    write(join(ws, "a.txt"), "line1\nline2\nline3\n");
    const ctx = makeToolCtx({ cwd: ws });
    const result = await createReadTool().execute({ file_path: "a.txt" }, ctx);
    expect(result.ok).toBe(true);
    const text = textOf(result);
    expect(text).toContain("line1");
    expect(text).toContain("line2");
    expect(text).toContain("line3");

    const slice = await createReadTool().execute({ file_path: "a.txt", offset: 2, limit: 1 }, ctx);
    expect(slice.ok).toBe(true);
    const sliceText = textOf(slice);
    expect(sliceText).toContain("line2");
    expect(sliceText).not.toContain("line1");
  });

  it("returns image blocks with base64 data", async () => {
    const ws = makeWorkspace();
    write(join(ws, "img.png"), PNG_1PX);
    const result = await createReadTool().execute({ file_path: "img.png" }, makeToolCtx({ cwd: ws }));
    expect(result.ok).toBe(true);
    expect(result.content.some((block) => block.type === "image")).toBe(true);
    const image = result.content.find((block) => block.type === "image");
    expect((image as { mime?: string })?.mime).toBe("image/png");
    expect(typeof (image as { data?: string })?.data).toBe("string");
    expect(((image as { data?: string })?.data ?? "").length).toBeGreaterThan(0);
  });

  it("extracts text from PDFs with page ranges", async () => {
    const ws = makeWorkspace();
    write(join(ws, "doc.pdf"), MINIMAL_PDF);
    const result = await createReadTool().execute({ file_path: "doc.pdf" }, makeToolCtx({ cwd: ws }));
    expect(result.ok).toBe(true);
    expect(textOf(result)).toContain("Hello PDF");

    const ranged = await createReadTool().execute({ file_path: "doc.pdf", pages: "1" }, makeToolCtx({ cwd: ws }));
    expect(ranged.ok).toBe(true);
  });

  it("renders Jupyter notebook cells", async () => {
    const ws = makeWorkspace();
    write(join(ws, "nb.ipynb"), NOTEBOOK);
    const result = await createReadTool().execute({ file_path: "nb.ipynb" }, makeToolCtx({ cwd: ws }));
    expect(result.ok).toBe(true);
    const text = textOf(result);
    expect(text).toContain("cell 1");
    expect(text).toContain("print(1)");
    expect(text).toContain("[output]");
  });

  it("rejects binary files", async () => {
    const ws = makeWorkspace();
    write(join(ws, "bin.dat"), Buffer.from([0x00, 0x01, 0x02, 0x03]));
    const result = await createReadTool().execute({ file_path: "bin.dat" }, makeToolCtx({ cwd: ws }));
    expect(result.ok).toBe(false);
    expect(textOf(result)).toContain("binary");
  });
});
