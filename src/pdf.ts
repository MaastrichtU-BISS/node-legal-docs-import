import { tidy } from "./normalise.js";
import type { InputFile, Parser, ParserOutput } from "./types.js";

/**
 * Pulls the text out of a PDF.
 *
 * The reading is done by pdfjs-dist. The Go package this replaces wrote its
 * own extractor first and threw it away, which is worth carrying forward: the
 * reason was not style. It handled files it had been written against and
 * produced nothing at all for a PDF printed by Chrome, whose object streams it
 * could not reach. A format with thirty years of extensions and a dozen ways
 * to encode the same page is not a weekend's work, and a parser that silently
 * returns nothing for a common generator is worse than an obvious gap.
 *
 * The legacy build is the one that runs under Node: the default build assumes
 * browser APIs and fails at import.
 *
 * What is left here is the part that is this package's business rather than a
 * PDF library's: deciding when a document is not worth storing.
 */
export const pdfParser: Parser = {
  extensions: [".pdf"],

  async parse(file: InputFile): Promise<ParserOutput> {
    if (!startsWithPdfHeader(file.data)) {
      throw new Error("not a PDF — the file may have been renamed");
    }

    await useOwnWorker();
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    // The teardown lives on the loading task rather than the document, so the
    // task has to be held: destroying it is what releases the worker, and a
    // leaked worker per upload adds up over a long-running platform.
    const task = getDocument({
      // pdfjs transfers the buffer it is given and leaves the caller's copy
      // detached; the importer still needs the bytes if this throws.
      data: new Uint8Array(file.data),
      // Nothing here should reach the network or the filesystem for fonts: a
      // document's text does not depend on rendering it.
      disableFontFace: true,
    });

    try {
      const doc = await task.promise;
      const pages: string[] = [];
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n);
        const content = await page.getTextContent();
        const parts = content.items.map((item) =>
          "str" in item ? item.str + (item.hasEOL ? "\n" : "") : "",
        );
        pages.push(parts.join(""));
        page.cleanup();
      }

      return {
        // Page breaks become blank lines. A reader sees paragraphs, and
        // anyone annotating by paragraph gets boundaries where the document
        // has them.
        full_text: tidy(pages.join("\n\n")),
        metadata: { pages: doc.numPages },
      };
    } finally {
      await task.destroy();
    }
  },
};

/**
 * Hands pdfjs its worker instead of letting it go and find one.
 *
 * Under Node pdfjs runs the worker on the main thread, and loads its code with
 * `await import(GlobalWorkerOptions.workerSrc)` — a specifier that defaults to
 * the relative string "./pdf.worker.mjs". That works from inside node_modules
 * and breaks the moment anything bundles this package: a bundler can follow an
 * import, but it cannot follow a string. What it did instead depended on the
 * bundler — a Nitro build left the file behind entirely ("Cannot find module
 * .../pdf.worker.mjs"), and inside the platform image it reached the browser
 * worker, which wants a DOM ("DOMMatrix is not defined"). Both are the same
 * bug wearing different clothes, and both only appear in a built server, which
 * is why a dev server and the test suite were happy.
 *
 * pdfjs looks at `globalThis.pdfjsWorker` before it resolves anything, so
 * importing the legacy worker here — by its real specifier, which a bundler
 * does follow — settles both which file is used and whether it was shipped.
 */
async function useOwnWorker(): Promise<void> {
  const g = globalThis as { pdfjsWorker?: unknown };
  if (g.pdfjsWorker) return;
  const { WorkerMessageHandler } = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  g.pdfjsWorker = { WorkerMessageHandler };
}

function startsWithPdfHeader(data: Uint8Array): boolean {
  const header = "%PDF-";
  if (data.length < header.length) return false;
  for (let i = 0; i < header.length; i++) {
    if (data[i] !== header.charCodeAt(i)) return false;
  }
  return true;
}
