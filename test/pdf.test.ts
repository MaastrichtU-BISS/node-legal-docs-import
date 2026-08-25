import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultImporter } from "../src/index.js";

/**
 * A real PDF, built here rather than committed as a fixture.
 *
 * Every other parser in this package can be tested against bytes written by
 * hand. A PDF cannot: the whole reason pdfjs is a dependency is that PDF is a
 * format with thirty years of extensions, and a fixture written by hand would
 * exercise none of that. So this generates one with a real producer, and skips
 * when that producer is not installed rather than pretending to pass.
 */
function makePDF(markdown: string): Uint8Array | null {
  try {
    execFileSync("pandoc", ["--version"], { stdio: "ignore" });
  } catch {
    return null;
  }
  const dir = mkdtempSync(join(tmpdir(), "docs-import-pdf-"));
  const md = join(dir, "in.md");
  const pdf = join(dir, "out.pdf");
  writeFileSync(md, markdown);
  execFileSync("pandoc", [md, "-o", pdf, "--pdf-engine=xelatex"], { stdio: "ignore" });
  return existsSync(pdf) ? new Uint8Array(readFileSync(pdf)) : null;
}

const pdf = makePDF(`# Hoge Raad ruling

The tenant shall pay rent on the first day of each month.

The landlord may terminate the agreement only with cause.
`);

describe.skipIf(pdf === null)("PDF", () => {
  it("extracts readable text from a real PDF", async () => {
    const { documents, skipped } = await defaultImporter().import([
      { name: "ruling.pdf", data: pdf! },
    ]);
    expect(skipped).toEqual([]);
    const text = documents[0]!.full_text;

    expect(text).toContain("The tenant shall pay rent");
    expect(text).toContain("The landlord may terminate");
    expect(documents[0]!.metadata?.["pages"]).toBe(1);
  });

  // Whatever pdfjs returns still has to satisfy the offset contract, or
  // annotations made on an imported PDF land in the wrong place.
  it("returns text with no CR and no BOM", async () => {
    const { documents } = await defaultImporter().import([{ name: "r.pdf", data: pdf! }]);
    const text = documents[0]!.full_text;
    expect(text).not.toContain("\r");
    expect(text.charCodeAt(0)).not.toBe(0xfeff);
    expect(text).toBe(text.trim());
  });
});
