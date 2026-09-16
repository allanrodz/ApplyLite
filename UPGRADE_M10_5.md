# ApplyLite M10.5 — Dashboard pipeline tabs

Version: 0.14.6

M10.5 reorganizes the main Dashboard so historical jobs no longer crowd the default queue.

## Tabs

- **Opportunities** — active jobs that have not been submitted or closed. This is now the default view.
- **Submitted** — submitted applications that are still active, including waiting/interview/offer outcomes.
- **Closed** — jobs marked Not pursuing plus applications whose tracker outcome is Withdrawn or Rejected.
- **All** — the full local history.

Existing M5 tracker history is reused, so previously withdrawn/rejected applications are categorized automatically.

## Marking jobs

Every active job has **Not pursuing**. For jobs with an application, ApplyLite records the local application outcome as `WITHDRAWN` and moves the posting to Closed. This is local only; it never contacts the employer or withdraws an application on an external website.

Manually stopped/withdrawn jobs can be restored. A previously submitted job returns to Submitted; an unsubmitted job returns to Opportunities. Employer rejections stay Closed unless their outcome is changed in the Applications page.

The job-level flag uses the existing `jobs.status` column (`NOT_PURSUING`), so there is no database migration or reset.

## Install

Stop `npm run dev`, extract this ZIP over the ApplyLite project, then run:

```powershell
cd "C:\path\to\apply-lite"
npm run typecheck
npm run dev
```

The app should report version `0.14.6`.
