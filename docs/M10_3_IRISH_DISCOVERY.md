# M10.3 Irish-market discovery

## Goal

Improve actual Ireland/Dublin job coverage without allowing generic remote labels to pull US-only roles into the shortlist.

## Source strategy

ApplyLite now uses three layers:

1. Direct employer ATS feeds: Lever, Ashby and Greenhouse.
2. Irish national/public market sources: JobsIreland and IrishJobs.
3. User-learned employer boards from imported supported URLs.

The national sources are intentionally bounded: only the configured target titles and one preferred Irish search location are queried, and only a small number of matching detail pages are fetched. This avoids turning discovery into a broad crawler.

## Location policy

When the user has Ireland/Dublin plus Remote configured, `remote` is treated as a work arrangement, not a geography. Explicit foreign scope such as US/Canada/India is rejected before Qwen. Ireland/Dublin, Europe/EMEA/worldwide and unscoped remote can still pass to detailed scoring.

## Analysis budget

The default deep-analysis budget is now 12. Existing saved M6 settings remain untouched and should be changed manually if still set to 6.
