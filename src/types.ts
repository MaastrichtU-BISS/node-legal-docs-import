/**
 * One parsed file, in the shape a platform stores and annotates.
 *
 * The field names match vue-legal-docs-import's ImportedDocument and the
 * documents table, so a document travels from a parser through an API into
 * storage without being renamed on the way. Every name that shifts in transit
 * is a place for a mapping bug.
 */
export interface ParsedDocument {
  name: string;
  source: string;
  full_text: string;
  metadata?: Record<string, unknown>;
}

/** A file that produced no document, and why. */
export interface Skipped {
  name: string;
  reason: string;
}

/** What an import produced. */
export interface ImportResult {
  documents: ParsedDocument[];
  skipped: Skipped[];
}

/** One uploaded file. */
export interface InputFile {
  /**
   * The original filename, extension included. It decides which parser runs
   * and, by default, what the document is called.
   */
  name: string;
  data: Uint8Array;
}

/** What a parser returns; the importer fills in name and source. */
export interface ParserOutput {
  full_text: string;
  name?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Turns one kind of file into a document.
 *
 * Parse receives the whole file in memory. That is a deliberate limit: these
 * are documents somebody wants to read and annotate, not archives, and
 * streaming would complicate every parser to accommodate a size nobody should
 * be importing through a browser.
 */
export interface Parser {
  /** Lowercased and dotted: ".txt", ".html". */
  extensions: string[];
  parse(file: InputFile): Promise<ParserOutput>;
}
