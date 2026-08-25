import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { defaultImporter, normaliseNewlines, stripBOM, tidy } from "../src/index.js";
import type { InputFile } from "../src/index.js";

const importer = defaultImporter();

function file(name: string, content: string | Uint8Array): InputFile {
  return { name, data: typeof content === "string" ? strToU8(content) : content };
}

describe("the text contract", () => {
  // This is the reason the parser is server-side at all. Offsets are character
  // positions into the stored text, so the same file has to normalise the same
  // way every time and everywhere.
  it("strips the BOM and makes every line ending LF", () => {
    expect(stripBOM("﻿line one")).toBe("line one");
    expect(normaliseNewlines("a\r\nb\rc\nd")).toBe("a\nb\nc\nd");
  });

  it("does the same through a real import", async () => {
    const { documents } = await importer.import([
      file("windows.txt", "﻿line one\r\nline two\rline three"),
    ]);
    expect(documents[0]?.full_text).toBe("line one\nline two\nline three");
  });

  // A CRLF file and an LF file with the same words must produce the same
  // offsets, or an annotation made on one points at the wrong text in the
  // other.
  it("gives the same offsets whichever machine saved the file", async () => {
    const unix = await importer.import([file("a.txt", "one\ntwo\nthree")]);
    const windows = await importer.import([file("b.txt", "one\r\ntwo\r\nthree")]);
    expect(unix.documents[0]?.full_text).toBe(windows.documents[0]?.full_text);
    expect(unix.documents[0]?.full_text.indexOf("three")).toBe(8);
  });

  it("collapses markup whitespace without joining paragraphs", () => {
    expect(tidy("  one   two  \n\n\n  three ")).toBe("one two\n\nthree");
    expect(tidy("\n\n\nleading blanks go\n")).toBe("leading blanks go");
  });
});

describe("plain text", () => {
  it("names a document after its file and records where it came from", async () => {
    const { documents } = await importer.import([file("ruling.txt", "The tenant shall pay rent")]);
    expect(documents[0]?.name).toBe("ruling");
    expect(documents[0]?.source).toBe("ruling.txt");
  });

  // A .txt extension is a claim, not a fact. A mislabelled binary produces an
  // annotation screen full of replacement characters, which looks like a bug
  // in the annotation tool rather than a bad upload.
  it("refuses a binary wearing a .txt extension", async () => {
    const { documents, skipped } = await importer.import([
      file("fake.txt", new Uint8Array([0xff, 0xfe, 0x00, 0x01, 0x80])),
    ]);
    expect(documents).toHaveLength(0);
    expect(skipped[0]?.reason).toMatch(/UTF-8/);
  });
});

describe("HTML", () => {
  it("keeps block structure and drops scripts and styles", async () => {
    const { documents } = await importer.import([
      file(
        "page.html",
        `<html><head><title>Hoge Raad 2024</title><style>p{color:red}</style></head>
         <body><script>alert(1)</script><p>First paragraph.</p><p>Second   paragraph.</p></body></html>`,
      ),
    ]);
    expect(documents[0]?.full_text).toBe("First paragraph.\nSecond paragraph.");
    // A <title> is a better document name than whatever the browser saved it as.
    expect(documents[0]?.name).toBe("Hoge Raad 2024");
  });
});

describe("Word documents", () => {
  function docx(parts: Record<string, string>): Uint8Array {
    const entries: Record<string, Uint8Array> = {};
    for (const [name, xml] of Object.entries(parts)) entries[name] = strToU8(xml);
    return zipSync(entries);
  }

  const body = `<?xml version="1.0"?>
    <w:document xmlns:w="x"><w:body>
      <w:p><w:r><w:t>First paragraph.</w:t></w:r></w:p>
      <w:p><w:r><w:t>Second</w:t><w:t xml:space="preserve"> paragraph.</w:t></w:r></w:p>
    </w:body></w:document>`;

  it("reads paragraphs out of the markup", async () => {
    const { documents } = await importer.import([
      file("ruling.docx", docx({ "word/document.xml": body })),
    ]);
    expect(documents[0]?.full_text).toBe("First paragraph.\nSecond paragraph.");
  });

  // Footnotes are where a legal document keeps its citations, so dropping them
  // loses exactly the sentences somebody most wants to annotate.
  it("appends footnotes after the body", async () => {
    const notes = `<?xml version="1.0"?>
      <w:footnotes xmlns:w="x"><w:p><w:r><w:t>See HR 12 May 2020.</w:t></w:r></w:p></w:footnotes>`;
    const { documents } = await importer.import([
      file("ruling.docx", docx({ "word/document.xml": body, "word/footnotes.xml": notes })),
    ]);
    expect(documents[0]?.full_text).toContain("See HR 12 May 2020.");
    expect(documents[0]?.full_text.indexOf("See HR")).toBeGreaterThan(
      documents[0]!.full_text.indexOf("Second paragraph."),
    );
  });

  // Some producers indent their XML. Collecting every text node would fold
  // that indentation into the document, shifting every offset after it.
  it("ignores indentation between elements", async () => {
    const indented = `<?xml version="1.0"?>
      <w:document xmlns:w="x">
        <w:body>
          <w:p>
            <w:r>
              <w:t>Only this.</w:t>
            </w:r>
          </w:p>
        </w:body>
      </w:document>`;
    const { documents } = await importer.import([
      file("indented.docx", docx({ "word/document.xml": indented })),
    ]);
    expect(documents[0]?.full_text).toBe("Only this.");
  });

  it("says so when a .doc was renamed to .docx", async () => {
    const { skipped } = await importer.import([file("old.docx", "\xD0\xCF\x11\xE0 not a zip")]);
    expect(skipped[0]?.reason).toMatch(/\.doc format is not supported/);
  });
});

describe("partial success", () => {
  // Somebody selects thirty files and two are corrupt. Failing the request
  // loses the twenty-eight that were fine and says nothing about which two.
  it("returns what parsed alongside what did not, in order", async () => {
    const { documents, skipped } = await importer.import([
      file("one.txt", "First"),
      file("notes.rtf", "unsupported"),
      file("two.txt", "Second"),
      file("empty.txt", ""),
      file("three.txt", "Third"),
    ]);

    expect(documents.map((d) => d.full_text)).toEqual(["First", "Second", "Third"]);
    expect(skipped.map((s) => s.name)).toEqual(["notes.rtf", "empty.txt"]);
    expect(skipped[0]?.reason).toBe("RTF files are not supported here");
    expect(skipped[1]?.reason).toBe("the file is empty");
  });

  it("lists the extensions it accepts, for the file picker", () => {
    expect(importer.extensions()).toEqual([
      ".docx",
      ".htm",
      ".html",
      ".md",
      ".pdf",
      ".text",
      ".txt",
      ".xhtml",
    ]);
  });

  it("refuses a PDF that is not one", async () => {
    const { skipped } = await importer.import([file("renamed.pdf", "just some text")]);
    expect(skipped[0]?.reason).toMatch(/not a PDF/);
  });
});
