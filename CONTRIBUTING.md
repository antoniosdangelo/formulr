# Contributing

Small, focused pull requests are easiest to review.

## Build and test
You need Node.js 22 or newer. There are no packages to install.

```
cd product/backend
npm test       # runs every test
npm run dev    # serves the add-in and the API on http://localhost:8793
```

The add-in in `product/frontend/` has no build step. Its files are served exactly as written.

## Open a pull request
1. Fork the repository and create a branch.
2. Add or update tests for what you change.
3. Open a pull request with a short summary of what changed for users and how you tested it.

Never commit keys, codes, Worker addresses, database ids or personal notes. Your own knowledge packs in `product/backend/knowledge/` are ignored by git.
