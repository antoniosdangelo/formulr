# Formulr

AI answers inside your Excel formulas, on **your own** AI key. Live site: **https://excel-ai-helper.comprsly-antonio.workers.dev**

Paste a question into B2, type `=FORMULR.ANSWER(B2)` in C2, and the answer fills C2 with a one line explanation in D2.

## What you need
- **Excel on the web** (free with any Microsoft account), or **Microsoft 365 Excel** on Windows or Mac. Older boxed versions such as Excel 2016 and 2019 do not run this kind of add-in. Desktop and Mac are less tested than the web.
- **Your own AI key** from one of these providers. Set a monthly spending limit with them first.

| Provider | Supported | Get a key |
|---|---|---|
| Anthropic (Claude) | Yes, needs a little prepaid credit | https://console.anthropic.com/settings/keys |
| Google Gemini | Yes, has a free tier with lower limits | https://aistudio.google.com/apikey |
| OpenAI and others | Not yet | |

The site has a guided **Get your AI key** box that checks your key works before you use it: https://excel-ai-helper.comprsly-antonio.workers.dev/#get-key

## Get Formulr
**Install page: https://excel-ai-helper.comprsly-antonio.workers.dev/install**

1. Open the install page and press **Download the add-in**. You get `formulr-manifest.xml`, a small file that tells Excel where Formulr lives.
2. In Excel open any workbook, then go to Insert, Add-ins, More Add-ins, My Add-ins, Manage My Add-ins, Upload My Add-in, and choose that file.
3. Click **Formulr** on the Home tab. No sign up and no access code are needed.
4. Under **Your AI key**, pick Anthropic or Gemini, paste **your own** key and press **Save key**. Formulr checks it with your provider before saving it.

Nothing to install on your laptop, and no GitHub or Cloudflare account.

## First use
1. Type or paste a question into **B2**.
2. In **C2** type `=FORMULR.ANSWER(B2)` and press Enter.
3. The answer appears in C2 and a short explanation in D2. Keep D2 empty so it has room.

| Formula | What it does |
|---|---|
| `=FORMULR.ANSWER(B2)` | The answer in one cell and a short explanation in the next. For multiple choice the answer is the option letter, and it always commits to one option. Takes a cell, a whole range, or text of any length. Add a second argument for an instruction, like `=FORMULR.ANSWER(B2, "in Spanish")`. |

`FORMULR.ANSWER` is the only function. The side bar can also answer selected cells without a formula and read a floating picture (click it, then press **Answer picture**). **Tidy** and **Expand** on the Home tab keep long question cells to one line and bring the full text back. They change only how cells look.

## Your own AI key, always
- Formulr never uses anyone else's AI key. Every person pastes their own, and their own AI account pays for their answers.
- **Where it is stored:** only on your device, in the add-in's storage in your browser. Press **Remove key** in the side bar to delete it.
- **Checking a key** goes straight from your device to Anthropic or Google. Formulr's server never sees it for that.
- **Each answer** sends the key over a secure connection to the Formulr Worker, which passes it to your provider for that one call and then drops it. It is never saved, logged or shown, and the usage database holds only a one way scrambled tag of it for rate limits.
- Without a key of your own, Formulr gives no answers. There is no shared key to fall back on.

```
Excel add-in (your key lives here)
   -> Formulr Worker: checks limits, forwards your key for this one call, keeps nothing
   -> Anthropic or Gemini, billed to your account
```

## Advanced: run your own copy
Only if you want your own server instead of the hosted one. You need a free [Cloudflare](https://dash.cloudflare.com/sign-up) account and [Node.js](https://nodejs.org) 18 or newer. Your users still bring their own keys.

1. Download this project and unzip it.
2. Double click `setup.cmd` on Windows, or run `./setup.sh` on Mac or Linux. It signs you in to Cloudflare, deploys your own Worker and prints your address.
3. Share `YOUR-ADDRESS/install` with your users.

**The owner code.** A key saved on the Worker itself can be used only with a pass from the `OWNER_CODE` secret, which only the person running that copy holds. Set it with `npx wrangler secret put OWNER_CODE` (12 or more characters, different from the access code). Guests have limits per key and per address (`GUEST_PER_MINUTE`, `GUEST_PER_DAY`, default 30 and 1500).

Full guide and settings: [docs/WALKTHROUGH.md](docs/WALKTHROUGH.md). Private reference material for prompts: [backend/knowledge/README.md](backend/knowledge/README.md).

## Troubleshooting
| What you see | Fix |
|---|---|
| `#NAME?` | Wait a minute and reload the workbook. If it stays, remove older Formulr entries in Manage My Add-ins and upload the file again. |
| "Add your own AI key" | Click Formulr on the Home tab and save your key. |
| `#N/A` about the AI provider | Wrong key, no credit, or a retired model. Check the key and your credit with the provider. |
| `#SPILL!` | The cell to the right is not empty. Clear it. |
| "Usage limit reached" | Wait a minute and try again. |
| Formulr is missing on another laptop | An uploaded add-in is remembered per browser. Upload the file again there. |

In the side bar, **Run checks** shows what your Excel supports. **Copy** gives a report you can share, and it never includes your key.

## Privacy and cost
- Your questions go only to the AI provider you picked. Formulr keeps no copy of questions or answers.
- Do not send data you are not allowed to share, such as confidential company files. See [SECURITY.md](SECURITY.md).
- Each new question is one call on your key, and a formula that recalculates when you reopen a workbook is another. For sheets you keep, copy the results and paste them as values.
- Models can be wrong, especially on long calculations. Check anything that matters.

## Development
```
cd backend && npm test          # Worker and add-in tests, Node.js 22 or newer
cd frontend/web && npm run build # rebuild the website into frontend/public
```
`frontend/public/` holds the add-in and the built site, `frontend/web/` the site source and the onboarding video, `backend/src/` the Worker. New work goes to `sandbox` first, see [BRANCHING.md](BRANCHING.md). Every update is in `CHANGELOG.md`.

## License
MIT. See [LICENSE](LICENSE). Not affiliated with or endorsed by Microsoft, Anthropic, Google or Cloudflare. Excel is a trademark of Microsoft.
