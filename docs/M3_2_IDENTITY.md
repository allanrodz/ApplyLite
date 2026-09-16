# M3.2 Candidate identity resolution

Candidate identity is resolved conservatively. ApplyLite prefers explicitly saved Profile data, then structured CV data. For older CV records created before `fullName` existed, it may recover a name from the stored raw CV text or source filename using a strict name-like heuristic. If no reliable candidate name is found, it retains the `Candidate` fallback instead of inventing one.

Cover-letter closings are sanitized before TXT/PDF rendering so placeholders such as `[Your Name]` cannot leak into generated artifacts.
