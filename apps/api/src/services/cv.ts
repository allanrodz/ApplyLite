import path from "node:path";
import { extractText } from "unpdf";
import mammoth from "mammoth";
import { z } from "zod";
import { CandidateFactsSchema, type CandidateFacts } from "@apply-lite/shared";
import { askOllamaStructured } from "./ollama.js";

export async function extractCvText(buffer: Buffer, filename: string, mimeType: string): Promise<string> {
  const extension = path.extname(filename).toLowerCase();

  if (mimeType === "application/pdf" || extension === ".pdf") {
    const result = await extractText(new Uint8Array(buffer), { mergePages: true });
    return String(result.text).trim();
  }

  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || extension === ".docx") {
    const result = await mammoth.extractRawText({ buffer });
    return result.value.trim();
  }

  if (mimeType.startsWith("text/") || [".txt", ".md"].includes(extension)) {
    return buffer.toString("utf8").trim();
  }

  throw new Error("Unsupported CV format. Use PDF, DOCX, TXT, or Markdown.");
}

function extractionPrompt(rawText: string) {
  return `You are extracting immutable candidate facts from a CV for a job-application assistant.

STRICT RULES:
- Use ONLY information explicitly present in the CV text below.
- fullName must be the candidate's full name exactly as written in the CV. If no candidate name is explicit, return an empty string.
- Never infer missing dates, employers, technologies, qualifications, years, metrics, responsibilities, or achievements.
- Preserve numbers and claims exactly as supported by the source.
- If a field is unknown, use an empty string or empty array.
- Skills must be explicitly stated or clearly named in a project/employment bullet. Do not infer adjacent technologies.
- evidenceNotes should contain short warnings about ambiguity, missing dates, unclear ownership, or anything a later tailoring model must not overstate.
- Return only data that conforms to the provided JSON schema.

CV TEXT:
${rawText.slice(0, 28_000)}

/no_think`;
}

export async function extractCandidateFacts(rawText: string): Promise<CandidateFacts> {
  if (rawText.trim().length < 80) throw new Error("The CV text is too short to extract reliable facts.");
  const schema = z.toJSONSchema(CandidateFactsSchema);
  const extracted = await askOllamaStructured<unknown>(extractionPrompt(rawText), schema);
  return CandidateFactsSchema.parse(extracted);
}
