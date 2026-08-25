import { normaliseNewlines, stripBOM } from "./normalise.js";
import type { InputFile, Parser, ParserOutput } from "./types.js";

/**
 * Reads plain text.
 *
 * The only real work is rejecting things that are not text. A .txt extension
 * is a claim, not a fact, and a mislabelled binary stored as a document
 * produces an annotation screen full of replacement characters — which looks
 * like a bug in the annotation tool rather than a bad upload.
 */
export const textParser: Parser = {
  extensions: [".txt", ".text", ".md"],

  async parse(file: InputFile): Promise<ParserOutput> {
    // fatal:true is what makes this a check rather than a silent mangling:
    // TextDecoder otherwise replaces every bad byte with U+FFFD and reports
    // success.
    let decoded: string;
    try {
      decoded = new TextDecoder("utf-8", { fatal: true }).decode(file.data);
    } catch {
      throw new Error("not valid UTF-8 text");
    }
    return { full_text: normaliseNewlines(stripBOM(decoded)) };
  },
};
