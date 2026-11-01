---
name: "fix-ticket"
description: End-to-end bug-fix workflow from a Jira ticket to a deployed preview and a Jira handoff - read the ticket, reproduce the bug (QA verify "bug found"), plan, implement on a dedicated branch, run a multi-agent code review, QA the fix, deploy to Vercel and hand the ticket back in Jira. Use whenever the user says "fix ticket", "fix PROJ-123", "take this Jira bug to done", pastes a Jira ticket key or URL and wants it fixed, or asks for the bug-to-done flow, even if they do not name the skill.
---

# Fix Ticket: Bug to Done

Take one Jira bug from "To Do" to "Ready for QA / Done" with proof at every stage. The point of the flow is that each stage produces evidence (a reproduction, a plan, a diff, review findings, test output, a preview URL), so the person reading the Jira ticket afterwards can trust the result without redoing the work.

## Parameters and config

Collect these at the start. Take values from the user's message first, then from `fix-ticket.config.json` in the repo root if it exists. Ask only for what is missing and cannot be inferred.

| Parameter | Meaning | Default |
|---|---|---|
| `ticket` | Jira key (e.g. `PROJ-123`) or full URL | required |
| `jira_site` | Atlassian site / cloud id | from the connector's accessible resources |
| `repo_path` | Local path of the repository | current working directory |
| `base_branch` | Branch to branch from and target | `main` (check `git symbolic-ref refs/remotes/origin/HEAD`) |
| `repro_command` | How to reproduce the bug (command, URL, or manual steps) | derived from the ticket |
| `test_command` | Test suite command | detect from `package.json` / project files |
| `review_agents` | Number of parallel reviewers | 3 |
| `vercel_project` | Vercel project name or linked `.vercel/` | detect from the repo |
| `deploy_target` | `preview` or `production` | `preview` |
| `jira_in_review_transition` | Transition name for handoff | look up with the transitions tool |

If a value is guessed rather than read, say so in the final summary. Never write Jira tokens, Vercel tokens or other secrets into the config file or the ticket.

## Branch strategy

- Branch from an up-to-date `base_branch`: `git fetch origin && git switch -c fix/<TICKET>-<short-slug> origin/<base_branch>`.
- One ticket = one branch = one pull request. Never commit to `base_branch` directly.
- Commit messages start with the ticket key: `PROJ-123: fix null total in cart summary`.
- Create the branch only after step 3 confirms the bug is real, so unreproducible tickets leave no stray branches.
- Push the branch and open the PR only after step 6 passes. Pushing is visible to others, so confirm with the user before the first push unless they already said to.

## Flow

Announce each step in one short line before starting it, and keep a task list with one task per step.

### Step 1: Setup
Resolve the parameters above, confirm the repo is clean (`git status`), and confirm the Jira connector responds (look up accessible resources). If Jira is not reachable, stop and say so; do not work from a pasted ticket unless the user provides the text.

### Step 2: Read the Jira ticket
Fetch the issue with description, comments, attachments list, priority, labels, linked issues and the current status. Extract and write down:
- Expected vs actual behavior
- Steps to reproduce, environment, affected version/URL
- Acceptance criteria (if absent, derive them and mark them as derived)
- Anything contradictory or missing

If the ticket is too vague to reproduce, add a Jira comment asking the specific missing questions (confirm with the user before posting) and stop.

### Step 3: QA verify - bug FOUND
Reproduce the bug before touching code. Run `repro_command` or follow the ticket steps, and capture evidence (command output, failing test, screenshot, console error).
- Prefer turning the reproduction into a failing automated test; it becomes the regression test later.
- Result is one of: **BUG FOUND** (continue), **NOT REPRODUCED** (stop, report what was tried, propose a Jira comment), **ALREADY FIXED** (stop, report the commit that fixes it if findable).
- Do not proceed on "probably reproduces". No evidence, no step 4.

### Step 4: Plan
Locate the root cause (not just the symptom). Write a short plan: root cause, files to change, the fix approach, risks and what could regress, how it will be tested. Keep it to what fits on one screen. If the fix is larger than the ticket suggests (touches many modules, changes public behavior), show the plan to the user and wait for approval before implementing. Otherwise continue.

### Step 5: Implementation
Create the branch (see Branch strategy). Make the smallest change that fixes the root cause. Add or keep the regression test from step 3 and make it pass. Do not refactor unrelated code or bump dependencies in this branch; note such ideas for a follow-up ticket instead. Run `test_command` and the linter/type check; report the real output.

### Step 6: Multi-agent code review
Spawn `review_agents` independent reviewers in parallel, each given the diff against `base_branch`, the ticket text and the plan, each with a different lens:
1. Correctness and edge cases (does it fix the root cause, what inputs break it)
2. Regression and side effects (callers, shared state, other features)
3. Security, performance and code quality (secrets, injection, N+1, style consistency)

Reviewers report findings as `blocker / should-fix / nit` with file and line. Merge duplicates, fix every blocker and should-fix, rerun tests, and if blockers were found run one more focused review pass. Report anything you chose not to fix and why. Reviewers have not seen the implementation reasoning, which is what makes them useful; do not feed them your justifications.

### Step 7: QA check
Re-run the exact reproduction from step 3 and confirm the bug is gone. Run the full test suite and report pass/fail counts from the actual output. Check each acceptance criterion explicitly (pass/fail per line). A single failure sends the flow back to step 5. If something could not be run (no browser, missing env vars), write "NOT RUN" with the reason; never imply it passed.

### Step 8: Vercel deploy and Jira handoff
1. Push the branch and open a PR (after the confirmation noted above).
2. Deploy: default is a **preview** deployment of the branch. Production deploys happen only if the user explicitly asked for `production` in this session.
3. Wait for the deployment to be ready, open the preview URL and re-verify the fix there (step 3's reproduction against the preview).
4. Post a Jira comment containing: root cause (2-3 lines), what changed, PR link, preview URL, test results, and how QA can verify. Keep it factual and short.
5. Transition the ticket (e.g. to In Review / Ready for QA) using the transition names the tools report. Do not close the ticket as Done unless the user asks; QA normally owns that.

Posting a comment and transitioning are visible to the team; if the user did not already authorize them, show the comment text and ask once.

## Final report

Finish with a short summary: ticket, branch, PR link, preview URL, what the root cause was, test results (real numbers), anything NOT RUN or assumed, and the one next step if any. No recap of the process.

## Failure rules

- No proof, no claim: every "fixed / passes / deployed" statement points to output you actually saw.
- Stop and report rather than improvise when: ticket unreachable, bug not reproduced, tests fail after two fix attempts, deploy fails. Say what happened and what you tried.
- Never put credentials in commits, comments or config.
