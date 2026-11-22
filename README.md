# Formulr

AI answers inside Excel formulas, paid for by **your own** AI key.

Type a question in one cell, then in the next cell:

```
=FORMULR.ANSWER(B2)
```

The answer fills that cell and a one line explanation fills the one beside it.

## Get Formulr
**Install page: https://excel-ai-helper.comprsly-antonio.workers.dev/install**

1. Open the install page and download the add-in file.
2. In Excel (on the web or desktop) go to Insert, Add-ins, Manage My Add-ins, Upload My Add-in, and choose that file.
3. Click **Formulr** on the Home tab and enter the access code you were given.
4. Under **Your AI key**, pick Anthropic or Gemini, paste **your own** key and press Save key.
5. Type a question in B2 and `=FORMULR.ANSWER(B2)` in C2.

That is all. No GitHub account, no Cloudflare account, nothing to install on your laptop.

## Your own AI key, always
- Formulr never uses anyone else's AI key. Every person pastes their own, and their own AI account pays for their answers.
- Your key stays on your device, in the add-in's storage in your browser. It is sent over a secure connection with each answer and is never saved, logged or shown on the server.
- Without a key of your own, Formulr gives no answers. There is no shared key to fall back on.
- Press **Remove key** in the side bar to delete it from your device at any time.

| Provider | Supported | Where to get a key |
|---|---|---|
| Anthropic (Claude) | Yes | https://console.anthropic.com/settings/keys |
| Google Gemini | Yes | https://aistudio.google.com/apikey |
| Others (OpenAI and so on) | Not yet | |

Set a monthly spending limit with your provider before you start.

## What it does
| Formula | What it does |
|---|---|
| `=FORMULR.ANSWER(B2)` | The answer in one cell and a short explanation in the next. For multiple choice the answer is the option letter, and it always commits to one option. Takes a cell, a whole range, or text of any length. Add a second argument for an instruction, like `=FORMULR.ANSWER(B2, "in Spanish")`. |

The side bar also answers selected cells without a formula and reads a floating picture (click it, then press **Answer picture**). The **Tidy** and **Expand** buttons on the Home tab keep long question cells to one line and bring the full text back. They only change how cells look, never what is in them.

Every update is explained in `CHANGELOG.md`.

## Advanced: run your own copy
Only for people who want their own server instead of the install page above. You need a free [Cloudflare](https://dash.cloudflare.com/sign-up) account and [Node.js](https://nodejs.org) 18 or newer (the Windows setup installs it with winget). Users of your copy still bring their own keys.

1. Download this project and unzip it.
2. Double click `setup.cmd` on Windows, or run `./setup.sh` on Mac or Linux. It signs you in to Cloudflare, deploys your own Worker, creates an access code and prints your address.
3. Share `YOUR-ADDRESS/install` and the access code with your users.

**Full step by step guide, troubleshooting and an FAQ: [docs/WALKTHROUGH.md](docs/WALKTHROUGH.md).**

The setup is safe to run again. `setup` re-deploys after a change, `setup --rotate-code` issues a new access code and signs out every device, `setup --reset-key` enters a new key for the Worker itself. For unattended runs (CI) set `CLOUDFLARE_API_TOKEN` (Workers Scripts Edit and D1 Edit), `CLOUDFLARE_ACCOUNT_ID`, `AIH_API_KEY` and `AIH_APP_PASSWORD` (12 or more characters), then run `node scripts/setup.mjs`. The Worker is named `excel-ai-helper` inside your Cloudflare account; that name is part of the setup and is kept as is.

**The owner code.** A key saved on the Worker itself is used only by a pass from the separate `OWNER_CODE` secret, which only the person running that copy holds. Set it with `npx wrangler secret put OWNER_CODE` (12 or more characters, different from the access code). Everyone who signs in with the normal access code must use their own key.

### Teach it your own material
Put notes, formula sheets or a glossary in the `backend/knowledge/` folder and redeploy. They are added to the model's instructions, only for questions that match a pattern you choose. Your files stay private (git ignores them). See [backend/knowledge/README.md](backend/knowledge/README.md).

### Configuration
Plain variables in `backend/wrangler.jsonc`:

| Variable | Default | Meaning |
|---|---|---|
| `ANTHROPIC_MODEL` | `claude-sonnet-5-5` | Anthropic model for every formula. Use lowercase model names. |
| `CALC_TOOLS` | `on` | Gives the model exact calculator tools for multiple choice questions and pictures. Set to `off` to disable. |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Model used when the key is a Gemini key. Check that the model is still available to new users. |
| `AI_PER_MINUTE`, `AI_PER_DAY` | 120, 5000 | Calls allowed. Guests and the owner each have their own count. |
| `LOGIN_PER_MINUTE`, `LOGIN_PER_DAY` | 6, 40 | Unlock attempts per client. |
| `ADDIN_ID` | built in | Optional. A GUID to use as the add-in id if you want your own. |

## How it works
```
Excel (add-in: custom functions + side bar, YOUR key kept here)
   -> Formulr Worker: checks the access code, applies usage limits, passes YOUR key on for this one call
   -> Anthropic or Gemini, billed to YOUR account
```
- The add-in files in `frontend/public/` are static and need no build step.
- The Worker (`backend/src/`) signs and checks short lived passes, limits usage with a small D1 database, builds the prompt, calls the provider with the key sent by the add-in, and returns only the answer and explanation.
- A request with no key of its own is refused before any AI call. Only an owner pass may use a key saved on the Worker.
- Long input is sent as written (up to 500,000 characters). A range is sent with line breaks between rows and tabs between cells.
- If an answer's explanation contradicts the answer, the Worker asks once more in careful mode, with the same key, and returns the clean result.

## Cost and safety
- Every new question uses one AI call on your key, and a formula that recalculates when you reopen a workbook uses another. For sheets you want to keep, copy the results and paste them as values.
- Text you send goes to the AI provider you picked. Do not send data you are not allowed to share. See [SECURITY.md](SECURITY.md).

## Known limits
- An uploaded add-in is remembered per browser. On a new browser or laptop, repeat the upload. A listing in the Microsoft Marketplace would remove that step; this project does not have one.
- Models can still be wrong, especially on long calculations. Check anything that matters.
- Excel limits a cell to 32,767 characters and a formula to 8,192, so paste long text into cells and point the formula at them.
- In-cell pictures ("Place in cell") are not readable through Excel's stable API. Use a floating picture, or paste it in the side bar's paste box.
- Tested by the author in Excel on the web with Claude. The automated tests cover the Worker, the add-in logic against a simulated Excel, the manifest and the setup script. Desktop Excel, Mac and Gemini are less tested. Reports and fixes are welcome.

## Development
Everything runs from the `backend/` folder:
```
cd backend
npm test           # Node.js 22 or newer, nothing to install
npm run knowledge  # rebuild src/knowledge.data.js from knowledge/
npx wrangler dev   # run the Worker and the add-in on your laptop (http://localhost:8787)
setup.cmd          # publish from the top folder: links YOUR database, then deploys (only from main, after Antonio's typed "deploy")
```
Layout:
```
frontend/public/   Add-in: custom functions, side bar, install page, headers (no build step)
backend/src/       Worker: routes and auth (worker.js), prompts and validation (core.js), manifest, knowledge loader
backend/scripts/   setup.mjs (one command deploy), smoke.mjs (live checks), build-knowledge.mjs
backend/knowledge/ Your private reference material (git ignores everything except the README and examples)
backend/test/      node:test suites
setup.cmd, setup.sh, reset-key.cmd   one click launchers, kept at the top so users find them
```
Branches: `main` is the working version, new work goes to `sandbox` first. See [BRANCHING.md](BRANCHING.md).
Turn on the safety hooks once per clone: `git config core.hooksPath .githooks`
Settings for local runs go in `backend/.env` (never committed), see `backend/.env.example`.

## License and notices
MIT. See [LICENSE](LICENSE).

Not affiliated with or endorsed by Microsoft, Anthropic, Google or Cloudflare. Excel is a trademark of Microsoft.
