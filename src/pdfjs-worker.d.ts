// pdfjs-dist ships no types for its worker entry point, because it is not
// meant to be imported directly — it is meant to be found at runtime through
// GlobalWorkerOptions.workerSrc. Importing it is exactly what makes this work
// when bundled; see useOwnWorker in pdf.ts.
//
// Only the one export is declared, because only the one is used and a wider
// guess would be fiction.
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}
