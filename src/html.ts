import { Parser as HtmlParser } from "htmlparser2";
import { stripBOM, tidy } from "./normalise.js";
import type { InputFile, Parser, ParserOutput } from "./types.js";

/**
 * Tags that end a line.
 *
 * Without this every block runs into the next and a document becomes one
 * paragraph, which destroys sentence and paragraph annotation levels before
 * anyone sees the text.
 */
const BLOCK = new Set([
  "address", "article", "aside", "blockquote", "br", "dd", "div", "dl", "dt",
  "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4",
  "h5", "h6", "header", "hr", "li", "main", "nav", "ol", "p", "pre", "section",
  "table", "tbody", "td", "tfoot", "th", "thead", "tr", "ul",
]);

/** Tags whose contents are code, not prose. */
const SKIP = new Set(["script", "style", "noscript", "template"]);

/** Reads HTML, keeping the block structure that paragraph annotation needs. */
export const htmlParser: Parser = {
  extensions: [".html", ".htm", ".xhtml"],

  async parse(file: InputFile): Promise<ParserOutput> {
    const source = stripBOM(new TextDecoder("utf-8").decode(file.data));

    const chunks: string[] = [];
    let title = "";
    let inTitle = false;
    let skipDepth = 0;

    const parser = new HtmlParser({
      onopentag(tag) {
        if (SKIP.has(tag)) skipDepth++;
        if (tag === "title") inTitle = true;
      },
      ontext(text) {
        if (skipDepth > 0) return;
        if (inTitle) {
          title += text;
          return;
        }
        chunks.push(text);
      },
      onclosetag(tag) {
        if (SKIP.has(tag) && skipDepth > 0) skipDepth--;
        if (tag === "title") inTitle = false;
        if (BLOCK.has(tag)) chunks.push("\n");
      },
    });
    parser.write(source);
    parser.end();

    const out: ParserOutput = { full_text: tidy(chunks.join("")) };
    // A <title> is what the page calls itself, and is a better document name
    // than the filename somebody's browser happened to save it under.
    const cleaned = tidy(title);
    if (cleaned !== "") out.name = cleaned;
    return out;
  },
};
