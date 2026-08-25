import { unzipSync } from "fflate";
import { Parser as XmlParser } from "htmlparser2";
import { tidy } from "./normalise.js";
import type { InputFile, Parser, ParserOutput } from "./types.js";

/**
 * Reads Word documents.
 *
 * A .docx is a zip archive holding XML, so unzipping and reading the markup
 * gets the text properly rather than approximately — no heuristics, and the
 * paragraph structure is right there in `<w:p>`. Unlike PDF there is no thirty
 * years of divergent encodings to keep up with, which is why this is done here
 * rather than handed to a library: the text is exactly what the markup says.
 *
 * .doc — the old binary format — is a different thing entirely and is not
 * handled.
 */
const DOCUMENT_PART = "word/document.xml";

/**
 * Text that belongs to the document but sits outside its body.
 *
 * Footnotes are where a legal document keeps its citations, so dropping them
 * loses exactly the sentences somebody most wants to annotate. Headers and
 * footers are deliberately not read: they repeat on every page, and injecting
 * "Hoge Raad — 3 van 12" between paragraphs would be noise in the middle of
 * the text rather than content.
 */
const NOTE_PARTS = ["word/footnotes.xml", "word/endnotes.xml"];

export const docxParser: Parser = {
  extensions: [".docx"],

  async parse(file: InputFile): Promise<ParserOutput> {
    let parts: Record<string, Uint8Array>;
    try {
      parts = unzipSync(file.data);
    } catch {
      // The usual cause is a .doc renamed to .docx, which is not a zip.
      throw new Error("not a readable Word file — the old .doc format is not supported");
    }

    const body = parts[DOCUMENT_PART];
    if (!body) throw new Error("no document text inside this file");

    // Notes follow the body, in the order Word stores them. Placing them at
    // the end rather than inline is what a printed document does, and keeps
    // the body's own sentences contiguous for anyone annotating them.
    const sections = [partText(body)];
    for (const name of NOTE_PARTS) {
      const part = parts[name];
      if (!part) continue;
      const text = partText(part);
      if (text.trim() !== "") sections.push(text);
    }

    return { full_text: tidy(sections.join("\n\n")) };
  },
};

/**
 * The readable text of one Word XML part.
 *
 * `w:t` holds the text, `w:p` ends a paragraph, `w:br` and `w:tab` are the
 * whitespace Word records structurally rather than as characters. Everything
 * else in the markup is formatting.
 */
function partText(data: Uint8Array): string {
  const chunks: string[] = [];
  // Only `w:t` holds text. Some producers indent their XML, and collecting
  // every text node would fold that indentation into the document — invisible
  // in the markup, and shifting every annotation offset after it.
  let inText = 0;

  const parser = new XmlParser(
    {
      onopentag(tag) {
        if (tag === "w:t") inText++;
        if (tag === "w:br" || tag === "w:cr") chunks.push("\n");
        if (tag === "w:tab") chunks.push(" ");
      },
      ontext(text) {
        if (inText > 0) chunks.push(text);
      },
      onclosetag(tag) {
        if (tag === "w:t" && inText > 0) inText--;
        if (tag === "w:p") chunks.push("\n");
      },
    },
    { xmlMode: true, decodeEntities: true },
  );
  parser.write(new TextDecoder("utf-8").decode(data));
  parser.end();

  return chunks.join("");
}
