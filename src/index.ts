// Turns uploaded files into documents worth annotating.
//
// This exists because the browser is the wrong place to do it.
// vue-legal-docs-import reads plain text itself, which is fine — a .txt file
// is already text. Anything else is not: a PDF needs a real parser, a scanned
// one needs OCR, and a .docx is a zip archive with XML inside. Shipping that
// to every visitor to run on their own machine is a lot of JavaScript to solve
// a problem a server solves once.
//
// It also has to be one implementation rather than one per platform, because
// annotation offsets are character positions into whatever this returns. See
// normalise.ts.
//
// # Partial success is the normal case
//
// Somebody selects thirty files and two are corrupt. Failing the request loses
// the twenty-eight that were fine and tells them nothing about which two. So an
// import returns documents and skipped files together, and throws only when it
// could not do its job at all.
//
// # Adding a format
//
// Write a Parser and pass it to createImporter. A later parser wins for an
// extension an earlier one claims, so a built-in can be replaced without
// forking anything — which is how a better PDF extractor than this one would
// arrive.

import { docxParser } from "./docx.js";
import { htmlParser } from "./html.js";
import { pdfParser } from "./pdf.js";
import { textParser } from "./text.js";
import type { ImportResult, InputFile, Parser, ParsedDocument, Skipped } from "./types.js";

export * from "./types.js";
export { normaliseNewlines, stripBOM, tidy } from "./normalise.js";
export { docxParser, htmlParser, pdfParser, textParser };

export interface Importer {
  /** What this importer accepts, sorted — for the file picker's accept list. */
  extensions(): string[];
  /** Parses every file it can. */
  import(files: InputFile[]): Promise<ImportResult>;
}

/**
 * An importer for the given parsers. Later parsers win for an extension both
 * claim, so a caller can override a built-in one.
 */
export function createImporter(...parsers: Parser[]): Importer {
  const byExtension = new Map<string, Parser>();
  for (const p of parsers) {
    for (const ext of p.extensions) byExtension.set(ext.toLowerCase(), p);
  }

  return {
    extensions: () => [...byExtension.keys()].sort(),

    async import(files: InputFile[]): Promise<ImportResult> {
      const documents: ParsedDocument[] = [];
      const skipped: Skipped[] = [];

      // Order is preserved: the documents come back in the order the files
      // were given, so a caller pairing them with anything else does not have
      // to re-sort.
      for (const file of files) {
        const ext = extensionOf(file.name);
        const parser = byExtension.get(ext);
        if (!parser) {
          skipped.push({ name: file.name, reason: `${describeExt(ext)} files are not supported here` });
          continue;
        }
        if (file.data.length === 0) {
          skipped.push({ name: file.name, reason: "the file is empty" });
          continue;
        }

        let parsed;
        try {
          parsed = await parser.parse(file);
        } catch (e) {
          skipped.push({ name: file.name, reason: e instanceof Error ? e.message : String(e) });
          continue;
        }

        if (parsed.full_text.trim() === "") {
          // A parser that ran but found nothing readable. Common with PDFs
          // that are scans, and worth saying rather than storing a blank.
          skipped.push({
            name: file.name,
            reason: "no readable text — it may be a scan, which needs OCR",
          });
          continue;
        }

        const doc: ParsedDocument = {
          name: parsed.name || baseName(file.name),
          source: file.name,
          full_text: parsed.full_text,
        };
        if (parsed.metadata) doc.metadata = parsed.metadata;
        documents.push(doc);
      }

      return { documents, skipped };
    },
  };
}

/** An importer for every format this package parses itself. */
export function defaultImporter(): Importer {
  return createImporter(textParser, htmlParser, docxParser, pdfParser);
}

/**
 * A filename without its extension, which is what a document is called when
 * the parser has nothing better to offer.
 */
export function baseName(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? filename;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

function extensionOf(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? filename;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot).toLowerCase() : "";
}

/** Names an extension the way the person who uploaded the file would. */
function describeExt(ext: string): string {
  return ext === "" ? "files with no extension" : ext.replace(".", "").toUpperCase();
}
