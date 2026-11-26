# Formulr branch rules

Written 2026-11-21.

## The two branches that always exist
- `main`: the working, tested code. This is the only branch a live deploy comes from.
- `sandbox`: where all new and test code goes first. It runs on your laptop (localhost), not on the internet.

## Work branches
One branch per piece of work. Name it with its side first, so the side is always visible:
- `frontend/<what>` for pages, screens and styling. Example: `frontend/notify-ui`.
- `backend/<what>` for servers, the database and jobs. Example: `backend/gateway-fix`.
- `docs/<what>` for documents only. Example: `docs/pitch-deck`.

A work branch is merged into `sandbox`, tested, and then deleted. Nothing is merged into `main` straight from a work branch.

## The path every change takes
1. Branch from `sandbox`.
2. Run the backend, then the front end, and use the product like a customer (see "Running it" below).
3. Run the tests. All must pass, except the known failures listed in `KNOWN_FAILURES.md` (none written yet).
4. Merge into `sandbox`. Delete the work branch.
5. When `sandbox` is good, merge it into `main`. Only the owner decides this.
6. Publishing to the website or to Fly is a separate step. It happens only from `main`, and only after the owner types "deploy" in the chat of the dev doing it.

## Running it (the sandbox test)
- `npm run dev` in `product/backend/` serves both the add-in and the API.
- Open the page, run the product through it, then run `npm test`.
- Every project must use the same three scripts: `dev`, `test`, `deploy`.

## Who may do what
- Devs: create work branches, merge into `sandbox`.
- The owner: merges `sandbox` into `main`, and approves every deploy.
- Nobody pushes straight to `main`. The push guard in `.githooks/pre-push` stops it on this laptop.
- Nobody commits secrets. The hook in `.githooks/pre-commit` stops it on this laptop.

## Turning the guards on (once per clone)
`git config core.hooksPath .githooks`

GitHub's own branch protection and secret scanning need a paid plan for private repos (not confirmed for this account), so these local hooks are the free version. They only protect machines that have them turned on.

## Folders inside the repo
See README.md: product/frontend/, product/backend/, docs/.

## Databases
- The repo holds the schema, never live data. Never commit *.sqlite, *.db or backups.
- Today: Cloudflare D1 excel-ai-helper-quotas. Target: MariaDB (proposal).

## Rebuild rule: it must match what exists now
The front end is rebuilt in React and TypeScript one page at a time, behind the same addresses.
A page counts as matching only when Playwright screenshots match the current live page at phone,
tablet and laptop widths, every link and button does what it does today, and the backend answers
the same requests the same way. Checked by tests, not by eye.
