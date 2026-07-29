/** Runs the one-shot LLM extraction job and returns the raw model output. */
export interface TeamImportBundleParserPort {
  parse(prompt: string, onProgress?: (receivedChars: number) => void): Promise<string>;
}
