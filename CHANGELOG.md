# Formulr change log

Every update to this repo, oldest first, in plain words. The short code is the commit id on GitHub.

## November 21, 2026: first upload (branch `main`)
- **f679eb4** Formulr exactly as it was working on Antonio's laptop: the Excel add-in, the Cloudflare Worker that answers the formulas, the knowledge packs, the one click setup files and the tests. Private course notes, private tests and the secrets file were kept out. Tests at this point: 161 total, 158 pass, 2 known failures in the setup tests, 1 skipped. **This is what `main` holds today, and it matches the live add-in.**

## November 21, 2026: reorganized (branch `sandbox`)
- **27f954f** Split into `frontend/` (the add-in files Excel loads) and `backend/` (the Worker, setup scripts, tests and knowledge packs). The one click setup files stay at the top so users still find them. Tests are unchanged after the move.
- **84b02e8** Added the live links to the README.
- Naming and descriptions: package renamed `formulr` and this change log added. The live Worker keeps the name `excel-ai-helper`, because changing it would change the live address and break installed add-ins, and the name is also built into the usage database and the sign in token.

## How updates work from now on
New work goes to `sandbox` first, gets tested, and only then is merged into `main` (production) when Antonio approves. See `BRANCHING.md`.
