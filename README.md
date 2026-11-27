# Formulr

AI answers inside your Excel formulas, paid for by **your own** AI key.

Paste a question into B2, type `=FORMULR.ANSWER(B2)` in C2, and the answer fills C2.

![Formulr answering a question in Excel](https://formulr.dev/media/formulr-onboarding.jpg)

Works in Microsoft 365 Excel on Windows and Mac, and in Excel on the web. Excel 2016 and 2019 are not supported.

## Install
1. Open **https://formulr.dev/install** and press **Download the add-in**.
2. In Excel go to Insert, Add-ins, More Add-ins, My Add-ins, Manage My Add-ins, Upload My Add-in, and choose the file.
3. Click **Formulr** on the Home tab. Under **Your AI key**, pick Anthropic or Gemini, paste your key and press **Save key**.

Need a key? The guide at https://formulr.dev/#get-key walks you through it and checks your key works. Set a monthly spending limit with your provider first.

## Use
| Formula | What it does |
|---|---|
| `=FORMULR.ANSWER(B2)` | The answer, in one cell. Takes a cell, a range, or text. |
| `=FORMULR.ANSWER(B2, "in Spanish")` | The same, with an extra instruction. |

Formulr never uses anyone else's AI key. Yours stays on your device and is never saved on our server. Your questions go only to the AI provider you picked. Each question is one call on your key, so for sheets you keep, paste the results as values. See [SECURITY.md](SECURITY.md).

Something wrong? In the side bar press **Run checks**, then **Copy** for a report you can share. It never includes your key.

## Build from source
```
cd product/backend
npm test       # Node.js 22 or newer
npm run dev    # the add-in and API on http://localhost:8793
```

To run your own copy on your own free Cloudflare account, follow [docs/WALKTHROUGH.md](docs/WALKTHROUGH.md). To contribute, see [CONTRIBUTING.md](CONTRIBUTING.md).

## License
MIT. See [LICENSE](LICENSE). Not affiliated with or endorsed by Microsoft, Anthropic, Google or Cloudflare. Excel is a trademark of Microsoft.
