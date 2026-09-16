# M10.4 Package Reliability

This milestone adds a fail-safe around M3-generated application documents.

## Reliability rules

1. Transient Ollama connection failures are retried automatically.
2. Resume and cover-letter generation are treated as core stages.
3. A core-stage failure creates a reviewable fallback, never a silently ready package.
4. M4 refuses to auto-upload degraded core documents.
5. Existing legacy packages with saved AI-generation failure warnings are treated as degraded too.
6. Fallback prose must be assembled from verified candidate skill evidence plus explicit job evidence.
7. Skill-specific year requirements are not satisfied by generic technical tenure unless the CV explicitly supports the skill-specific duration.

Final employer submission remains manual.
