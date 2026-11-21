# Contributing

Thanks for helping. Small, focused pull requests are easiest to review.

1. Fork the repository and create a branch.
2. Run the tests: `npm test` (Node.js 22 or newer; no packages to install).
3. Add or update tests for what you change. The suite checks the Worker, the add-in logic against a fake Excel, the manifest and the setup script.
4. Open a pull request that says what changed and why.

Ground rules
- Never commit keys, access codes, Worker addresses, database ids or personal notes. Your own knowledge packs belong in `knowledge/` and are ignored by git.
- Keep the add-in working without any build step. The files in `frontend/public/` are served exactly as written.
- If you change what the model is asked to do (`backend/src/core.js`), include a test that shows the request that will be sent.
