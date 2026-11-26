# Formulr change log

Every update to this repo, oldest first, in plain words. The short code is the commit id on GitHub.

## November 21, 2026: first upload (branch `main`)
- **f679eb4** Formulr exactly as it was working on the owner's laptop: the Excel add-in, the Cloudflare Worker that answers the formulas, the knowledge packs, the one click setup files and the tests. Private course notes, private tests and the secrets file were kept out. Tests at this point: 161 total, 158 pass, 2 known failures in the setup tests, 1 skipped. **This is what `main` holds today, and it matches the live add-in.**

## November 21, 2026: reorganized (branch `sandbox`)
- **27f954f** Split into `frontend/` (the add-in files Excel loads) and `backend/` (the Worker, setup scripts, tests and knowledge packs). The one click setup files stay at the top so users still find them. Tests are unchanged after the move.
- **84b02e8** Added the live links to the README.
- Naming and descriptions: package renamed `formulr` and this change log added.
- README now opens with a "Bring your own AI key" section: Formulr never uses anyone else's key, each person deploys their own copy with their own Anthropic or Gemini key. The owner's own Worker address was removed from the README and the GitHub homepage, so nobody is pointed at his key. The live Worker keeps the name `excel-ai-helper`, because changing it would change the live address and break installed add-ins, and the name is also built into the usage database and the sign in token.

## November 21, 2026: fix (branch `backend/ship-placeholder-db-id`)
- The first upload carried the owner's own Cloudflare database id in `backend/wrangler.jsonc`. The repo must ship the blank placeholder id, because each user's setup links their own database. This was the cause of the 2 "known" setup test failures. With the placeholder, all tests pass. The README now says to publish with `setup.cmd`, which links the right database before deploying.

## November 22, 2026: where things stand
Live at https://excel-ai-helper.comprsly-antonio.workers.dev, deployed from `main`.
- **Bring your own key, no access code.** Users paste their own Anthropic or Gemini key in the Formulr pane. The key check goes from their device straight to the provider. Each answer passes the key through the Worker for that one call and never stores or logs it. A request with no key gets 403 before any AI call. Limits apply per key and per address.
- **Owner pass.** `OWNER_CODE` is set as a Worker secret, with a local copy in the git ignored `backend/.env`. Only that pass uses the key saved on the Worker.
- **Website.** A white, minimal page built with Vite, React and TypeScript, with the source in `frontend/web` and the build in `frontend/public`. It has a live Excel style demo, motion that is off for reduced motion, a guided key setup box (shadcn/ui and Magic UI, MIT notices kept), and a 27 second onboarding video in `frontend/public/media` (source in `frontend/web/video`).
- **Stack.** One Cloudflare Worker in plain JavaScript serves the site and the API. D1 holds rate limit counters only. Node is used only for tests, building and deploying. Dev ports are Vite 5175 and wrangler dev 8793.
- **Checks.** Pull requests run tests, a web build diff and a secret scan. A scheduled live check runs the public smoke test every 6 hours once the `FORMULR_URL` repository secret is set.
- **Open.** Nobody has run a real answer with a real key in real Excel since these changes, so do that first. Cloudflare cleanup is owned by the Orchestrator: the old `excel-ai-cells` copy still gets traffic, plus the TipNudge zone and the account workers.dev rename. Next level ideas are a Microsoft Marketplace listing, an OpenAI provider, and more testing on desktop Excel and Mac.

## November 26, 2026: formulr.dev
- The app now lives at https://formulr.dev, attached to the same Worker as a custom domain. The old workers.dev address keeps working, so add-ins installed from it keep answering. The domain is set only in the owner's local `backend/wrangler.jsonc`, so self hosted copies are not affected.

## November 26, 2026: product and website split
- The repo now holds only the product: `product/frontend` (the Excel add-in) and `product/backend` (the API Worker). The marketing site, demo video and site source moved to a private `formulr-website` repo.
- The product moves to https://app.formulr.dev, and formulr.dev becomes the website. `/` and `/install` on the product redirect there. Add-ins installed from formulr.dev before the move need the add-in file once more.

## How updates work from now on
New work goes to `sandbox` first, gets tested, and only then is merged into `main` (production) when the owner approves. See `BRANCHING.md`.
