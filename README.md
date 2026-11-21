# Formulr

AI formulas for Excel, running on your own Cloudflare account with your own AI key.

Type a question in one cell, then in the next cell:

```
=FORMULR.ANSWER(B2)
```

The answer fills that cell and a short explanation fills the one beside it. Nothing is shared: you deploy your own copy, and your key never leaves your Cloudflare account.

| Formula | What it does |
|---|---|
| `=FORMULR.ANSWER(B2)` | A short answer in one cell and a brief explanation in the next. Takes a cell, a whole range, or text of any length and format. Add a second argument for an instruction, like `=FORMULR.ANSWER(B2, "in Spanish")`. |
| `=FORMULR.ANSWER(B2)` | Just the answer, in one cell: a number, or the option letter for multiple choice. It always commits to one option. Add text after it for an instruction, like `=FORMULR.ANSWER(B2, "in Spanish")`. |

The side bar also has buttons that answer selected cells without a formula, read a picture (select the cell under its top left corner) into cells, and **Tidy** and **Expand** buttons on the Excel ribbon (Home tab, Formulr group). They keep long question cells to one line and bring the full text back; they only change how cells look, never what is in them, and nothing happens automatically.

## Live links
- Antonio's Worker: https://excel-ai-helper.comprsly-antonio.workers.dev (health check: `/health`)
- Code: https://github.com/antoniosdangelo/formulr (private)

## How you use it, in short
Everything runs in **your own** accounts. There is no shared server and no shared AI key, so nobody else pays for your usage and nobody else sees your questions.

1. Get an AI key from [Anthropic](https://console.anthropic.com/settings/keys) (or [Google Gemini](https://aistudio.google.com/apikey)) and set a monthly spending limit.
2. Download this project (**Code**, then **Download ZIP**) and unzip it.
3. Run the setup: double click `setup.cmd` on Windows, or run `./setup.sh` on Mac or Linux. It signs you in to a free [Cloudflare](https://dash.cloudflare.com/sign-up) account, deploys your own Worker, saves your key and a new access code, and prints your address.
4. Open `YOUR-ADDRESS/install` in a browser, download the file, and upload it in Excel (Insert, Add-ins, Manage My Add-ins, Upload My Add-in). Click **Formulr** on the Home tab and enter the access code once.
5. Type a question in B2 and `=FORMULR.ANSWER(B2)` in C2.

**Full step by step guide, with what to expect at each step, troubleshooting and an FAQ: [docs/WALKTHROUGH.md](docs/WALKTHROUGH.md).**

Requirements: a free Cloudflare account, an AI key with a little credit, [Node.js](https://nodejs.org) 18 or newer (Windows setup installs it with winget), and Excel on the web, Windows or Mac.

The setup is safe to run again. Later: `setup` re-deploys after you change something, `setup --rotate-code` issues a new access code and signs out every device, `setup --reset-key` enters a new AI key. For unattended runs (CI) set `CLOUDFLARE_API_TOKEN` (Workers Scripts Edit and D1 Edit), `CLOUDFLARE_ACCOUNT_ID`, `AIH_API_KEY` and `AIH_APP_PASSWORD` (12 or more characters), then run `node scripts/setup.mjs`.

## Teach it your own material
Put notes, formula sheets or a glossary in the `backend/knowledge/` folder and redeploy. They are added to the model's instructions, only for questions that match a pattern you choose. Your files stay private (git ignores them). See [backend/knowledge/README.md](backend/knowledge/README.md).

## Configuration
Plain variables in `backend/wrangler.jsonc`:

| Variable | Default | Meaning |
|---|---|---|
| `ANTHROPIC_MODEL` | `claude-sonnet-5-5` | Model for every formula. Use lowercase model names. |
| `CALC_TOOLS` | `on` | Gives the model exact calculator tools for multiple choice questions and pictures. Set to `off` to disable. |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Used only if you set a Gemini key and no Anthropic key. Check that the model is still available to new users. |
| `AI_PER_MINUTE`, `AI_PER_DAY` | 120, 5000 | Calls the Worker allows. Lower these to cap your spend. |
| `LOGIN_PER_MINUTE`, `LOGIN_PER_DAY` | 6, 40 | Unlock attempts per client. |
| `ADDIN_ID` | built in | Optional. A GUID to use as the add-in id if you want your own. |

## How it works
```
Excel (add-in: custom functions + side bar)  ->  YOUR Cloudflare Worker  ->  Anthropic or Gemini (YOUR key)
                                                  checks the access code,
                                                  applies usage limits,
                                                  holds your AI key
```
- The add-in files in `frontend/public/` are static and need no build step.
- The Worker (`backend/src/`) signs and checks short lived passes, limits usage with a small D1 database, builds the prompt, calls the provider, and returns only the answer and explanation.
- Long input is sent as written (up to 500,000 characters). A range is sent with line breaks between rows and tabs between cells.
- If an answer's explanation contradicts the answer, the Worker asks once more in careful mode and returns the clean result.

## Cost and safety
- Every new question uses one AI call, and a formula that recalculates when you reopen a workbook uses another. For sheets you want to keep, copy the results and paste them as values.
- The access code is one shared secret. Anyone who has it can spend your credit. Set a spending limit with your provider, keep `AI_PER_DAY` low, and rotate the code if it leaks.
- Text you send goes to the AI provider you configured. Do not send data you are not allowed to share. See [SECURITY.md](SECURITY.md).

## Known limits
- An uploaded add-in is remembered per browser. On a new browser or laptop, repeat the upload. A listing in the Microsoft Marketplace would remove that step; this project does not have one.
- Models can still be wrong, especially on long calculations. Use `CAREFUL` for numbers and check anything that matters.
- Excel limits a cell to 32,767 characters and a formula to 8,192, so paste long text into cells and point the formula at them.
- In-cell pictures ("Place in cell") are not readable through Excel's stable API. Use a floating picture.
- Tested by the author in Excel on the web with Claude. The automated tests cover the Worker, the add-in logic against a simulated Excel, the manifest and the setup script. Desktop Excel, Mac and Gemini are less tested. Reports and fixes are welcome.

## Development
Everything runs from the `backend/` folder:
```
cd backend
npm test           # Node.js 22 or newer, nothing to install
npm run knowledge  # rebuild src/knowledge.data.js from knowledge/
npx wrangler dev   # run the Worker and the add-in on your laptop (http://localhost:8787)
npm run deploy     # publish (only from main, after Antonio's typed "deploy")
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
Settings for local runs go in `backend/.dev.vars` (never committed), see `backend/.dev.vars.example`.

Known test failures (also before the folder move, 2 of 161): "the D1 block can be read and rewritten" and "running again changes nothing" in `test/setup.test.mjs`.

## License and notices
MIT. See [LICENSE](LICENSE).

Not affiliated with or endorsed by Microsoft, Anthropic, Google or Cloudflare. Excel is a trademark of Microsoft.
