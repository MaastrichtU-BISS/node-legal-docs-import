// The text contract, and the reason this package is server-side at all.
//
// Annotation offsets are character positions into the stored text. Every
// document that reaches storage therefore has to be normalised the same way,
// by one implementation, or the same file imported twice produces annotations
// that point at different words.
//
// These three functions are a direct port of go-legal-docs-import's, kept
// deliberately dull. Changing any of them shifts every offset in every
// document imported afterwards, and silently: nothing throws, the annotations
// simply stop lining up with the text they were made against.

/**
 * Removes a byte order mark, which Windows editors add and which otherwise
 * becomes an invisible first character of every document.
 */
export function stripBOM(s: string): string {
  return s.startsWith("﻿") ? s.slice(1) : s;
}

/**
 * Makes line endings LF.
 *
 * A document saved on Windows carries CRLF, so every line before an annotation
 * shifts it by one against the same document imported on another machine — and
 * the annotation silently points at the wrong words.
 */
export function normaliseNewlines(s: string): string {
  return s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/**
 * Collapses the whitespace that markup leaves behind, without joining
 * paragraphs: blank lines between them are meaningful to a reader and to
 * anyone annotating by paragraph.
 */
export function tidy(s: string): string {
  const out: string[] = [];
  let blank = true; // leading blank lines are dropped

  for (const raw of normaliseNewlines(s).split("\n")) {
    const line = raw.split(/\s+/).filter(Boolean).join(" ");
    if (line === "") {
      if (!blank) out.push("");
      blank = true;
      continue;
    }
    out.push(line);
    blank = false;
  }
  return out.join("\n").replace(/\n+$/, "");
}
