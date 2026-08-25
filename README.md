# node-legal-docs-import

Turns uploaded files into documents worth annotating. Text, HTML, Word and PDF.

```bash
npm install node-legal-docs-import
```

```ts
import { defaultImporter } from "node-legal-docs-import";
import { readFile } from "node:fs/promises";

const { documents, skipped } = await defaultImporter().import([
  { name: "ruling.pdf", data: await readFile("ruling.pdf") },
]);

documents[0];
// { name: "ruling", source: "ruling.pdf", full_text: "…", metadata: { pages: 12 } }
```

## Why this is server-side

The browser is the wrong place to do this. A PDF needs a real parser, a scanned
one needs OCR, and a `.docx` is a zip archive with XML inside. Shipping that to
every visitor to run on their own machine is a lot of JavaScript to solve a
problem a server solves once.

There is a second reason, and it is the one that matters:

> **Annotation offsets are character positions into the text this returns.**

A document saved on Windows carries CRLF. Every line before an annotation
shifts it by one against the same document imported on another machine, and the
annotation silently points at the wrong words. Nothing throws; the text simply
stops lining up with the work made against it.

So every document that reaches storage is normalised the same way, by one
implementation:

- the byte order mark is stripped
- `\r\n` and `\r` become `\n`
- markup whitespace is collapsed **without** joining paragraphs, because a
  blank line between them is meaningful to a reader and to anyone annotating by
  paragraph

Those three rules are the contract. Changing any of them shifts every offset in
every document imported afterwards.

## Partial success is the normal case

Somebody selects thirty files and two are corrupt. Failing the whole request
loses the twenty-eight that were fine and says nothing about which two. So an
import returns both, and throws only when it could not do its job at all:

```ts
const { documents, skipped } = await importer.import(files);
// skipped: [{ name: "notes.rtf", reason: "RTF files are not supported here" }]
```

A file that parses to nothing is skipped rather than stored blank — common with
PDFs that are scans, and the reason says so.

## Formats

| | |
|---|---|
| `.txt` `.text` `.md` | UTF-8 is verified, not assumed — a mislabelled binary is refused rather than stored as replacement characters |
| `.html` `.htm` `.xhtml` | block tags end lines, `<script>` and `<style>` are dropped, `<title>` becomes the document name |
| `.docx` | unzipped and read as markup: body text, then footnotes and endnotes. Headers and footers are deliberately skipped — they repeat on every page and would be noise between paragraphs. `.doc` is a different format and is not handled |
| `.pdf` | via `pdfjs-dist` |

`importer.extensions()` lists them, for a file picker's accept list.

## Adding a format

Implement `Parser` and pass it to `createImporter`. A later parser wins for an
extension an earlier one claims, so a built-in can be replaced without forking
anything.

```ts
import { createImporter, textParser, htmlParser } from "node-legal-docs-import";

const importer = createImporter(textParser, htmlParser, myBetterPdfParser);
```

## A note on PDF text

`pdfjs-dist` does not produce byte-identical output to other extractors — this
package's Go predecessor, `go-legal-docs-import`, used `ledongthuc/pdf`.

That only matters when re-importing **the same PDF** into a dataset that already
carries annotations, where the offsets would shift. New imports are unaffected,
and re-importing a document keeps its id precisely so that annotations survive —
so this is the one case to be careful about.

## Development

```bash
npm install
npm test        # vitest
npm run build   # tsc -> dist/
```

The PDF tests build a real PDF with `pandoc` rather than using a committed
fixture, because a fixture written by hand exercises none of what `pdfjs` is
here for. They skip when `pandoc` is not installed rather than passing quietly.

## License

MIT
