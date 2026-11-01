# Fix Ticket skill: Bug to Done

Takes one Jira bug from "To Do" to a deployed Vercel preview and a Jira handoff, with evidence at every step.

| Step | What happens |
|---|---|
| 1. Setup | Resolve parameters, check the repo is clean and Jira responds |
| 2. Read Jira ticket | Expected vs actual, repro steps, acceptance criteria |
| 3. QA verify | Reproduce first: **BUG FOUND** / NOT REPRODUCED / ALREADY FIXED |
| 4. Plan | Root cause, files, approach, risks, test plan |
| 5. Implementation | `fix/<TICKET>-<slug>` branch, smallest fix plus a regression test |
| 6. Multi-agent code review | 3 parallel reviewers: correctness, regressions, security/perf |
| 7. QA check | Re-run the repro, full test suite, each acceptance criterion |
| 8. Vercel deploy & Jira handoff | Push, PR, preview deploy, Jira comment, transition to In Review |

Full instructions are in [SKILL.md](SKILL.md). Parameters are listed in its "Parameters and config" table.

## Setup on Windows (F:\shibass-ai)

1. Download this `fix-ticket` folder (or `fix-ticket.zip`) and unzip it anywhere.
2. In PowerShell, from inside the folder:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\install-windows.ps1
   ```

   This copies the skill to `F:\shibass-ai\fix-ticket` and to `%USERPROFILE%\.claude\skills\fix-ticket`, where Claude Code loads personal skills. Use a different folder with `-Target "D:\shibass-ai"`.
3. Copy `fix-ticket.config.example.json` into your project root as `fix-ticket.config.json` and fill it in. Never put tokens in it.
4. Connect Jira (Atlassian connector) and Vercel (CLI logged in, or connector) in Claude Code.
5. Run it:

   ```
   /fix-ticket PROJ-123
   ```

## Dry run

`fixtures/SHB-142.md` is a sample ticket. Paste it in, or say "take this bug to done, see fixtures/SHB-142.md".
