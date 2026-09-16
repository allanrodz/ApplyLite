# M4.1 — Adaptive Field Intelligence and Skill Growth

## Adaptive mapping lifecycle

1. Read semantic field metadata.
2. Check a previously learned ATS/fingerprint mapping.
3. Compute a standard-field confidence score.
4. Autofill only above the high-confidence threshold.
5. Persist successful semantic mappings.
6. When the user manually fills an unknown field and asks ApplyLite to refill the step, compare the existing value with trusted Profile/Answer Library values and learn the mapping.

Learned mappings store only the field fingerprint/key metadata and confidence; Profile values remain in the Profile record.

## Skill-demand model

For each analysed job:
- required skill occurrence = 3 priority points
- preferred skill occurrence = 1.25 priority points

Candidate evidence is built from saved profile skills, CV skills, and project technologies. The overview is recalculated from current data rather than treated as a static AI opinion.

## Learning plans

The local model receives only the target skill, job-demand context, and whether candidate evidence already exists. It generates a project plan rather than claiming new experience. Learning material URLs are inserted from a curated official-resource map where possible; unknown technologies use a documentation search link rather than an invented URL.
