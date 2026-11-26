# Walkthrough: from nothing to your first formula

This guide assumes you have never deployed anything. It takes about 15 minutes the first time.

## The idea in one minute
Formulr is software you run yourself. Nobody hosts it for you, and there is no shared account or shared AI key.

```
You type  =FORMULR.ANSWER(B2)  in Excel
        |
        v
Your own Worker on your own free Cloudflare account   <- you deploy this once with one command
        |
        v
The AI provider you chose (Anthropic or Google Gemini), using YOUR key
```

- You pay your AI provider directly for what you use (a typical question usually costs a fraction of a cent to a few cents, depending on the model and the length of your text).
- The author of this project never sees your questions, your key or your usage.
- The address you get at the end (for example `https://excel-ai-helper.your-name.workers.dev`) belongs to you. The links in this guide that say `YOUR-ADDRESS` mean that address.

## What you need
| You need | Cost | Where |
|---|---|---|
| A Cloudflare account | Free | https://dash.cloudflare.com/sign-up |
| An AI key: Anthropic (recommended) or Google Gemini | Pay as you go | https://console.anthropic.com/settings/keys or https://aistudio.google.com/apikey |
| Node.js 18 or newer | Free | https://nodejs.org (Windows: the setup file installs it for you) |
| Excel on the web, Windows or Mac | Your existing Excel | |

## Step 1. Get an AI key and set a limit
1. Create an account with your AI provider and add a small amount of credit (5 to 10 dollars is plenty to start).
2. Create an API key. It starts with `sk-ant-` for Anthropic. Copy it somewhere safe for the next 10 minutes. Never post it anywhere.
3. In the provider's console, set a **monthly spending limit** so a mistake can never cost more than you chose.

## Step 2. Download the project
No git needed. On the GitHub page for this project, click the green **Code** button, then **Download ZIP**. Unzip it into a folder you will keep (not inside the zip preview).

## Step 3. Run the setup
- **Windows:** double click `setup.cmd`. If Windows says "unknown publisher", choose More info, then Run anyway. It is a short text file you can open in Notepad first.
- **Mac or Linux:** open Terminal, type `cd ` (with a space), drag the folder into the window, press Enter, then run `./setup.sh`.

You will see six steps:
1. **Log in to Cloudflare.** A browser window opens. Approve it.
2. **Usage database.** It creates a tiny database that counts calls so you can cap them.
3. **Deploy.** It uploads the Worker and the add-in files.
4. **Secrets.** It asks for your AI key. Paste it (nothing shows on screen as you paste) and press Enter. It also creates a strong **access code** and shows it **once**. Write it down. This is the password for opening Formulr in Excel.
5. **Check.** It tests the live service.
6. **Next steps.** It prints your address.

It is safe to run the setup again at any time. It reuses what it already created.

## Step 4. Add it to Excel
1. Open `YOUR-ADDRESS/install` in your browser. It has a **Download** button and the same steps below.
2. Click **Download** to save `formulr-manifest.xml`.
3. Open Excel (web or desktop) and open any workbook.
4. Go to **Insert**, then **Add-ins**, then **More Add-ins**, then **My Add-ins**, then **Manage My Add-ins**, then **Upload My Add-in**. Choose the file.
5. On the **Home** tab click **Formulr**. Enter your access code once. Leave "Remember on this device" ticked.

## Step 5. Your first formula
Type a question in B2. For example: `If a shirt costs $40 and is 25% off, what is the sale price?`
In C2 type:

```
=FORMULR.ANSWER(B2)
```

The answer fills C2, just the answer, in one cell.

Good habits
- Pasting a long multi-line question? Two clean ways:
  - Click the cell, press **F2**, paste, press Enter: the whole text goes into one cell. To stop Excel growing the row, select that cell once and click **Tidy** on the ribbon (Home tab, Formulr group). **Expand** shows the full text again. They only change how cells look, never what is in them, and nothing happens automatically.
  - Or just paste onto the cell (Excel puts each line in its own row) and point the formula at the block with room to spare, such as `=FORMULR.ANSWER(A1:A40)`. Blank rows around the text are ignored.
- To answer many questions quickly, put one question per row and fill the formula down. Up to eight are asked at the same time. **Speed test (6 calls)** in the side bar shows how long a batch takes on your setup.
- To use a whole block of cells as the question, point at the range: `=FORMULR.ANSWER(B2:B9)`.
- When you are done with a sheet, copy the results and paste them as values. Otherwise Excel asks the AI again every time the workbook recalculates.

## Using it on another laptop
Uploading an add-in is remembered per browser. On a new laptop or browser, open `YOUR-ADDRESS/install` and repeat Step 4. You do not need to run the setup again. The service keeps running on Cloudflare whether or not your own computer is on.

## Letting friends use it
Best: each person deploys their own copy with this guide. That way each pays for their own usage.
Alternatively you can share your address and access code with someone you trust. They will spend your AI credit, so keep the daily limit low and rotate the code afterwards.

## Changing things later
| I want to | Do this |
|---|---|
| Update after changing something | Run the setup again |
| Get a new access code (signs out every device) | `setup --rotate-code` (Windows: `setup.cmd --rotate-code`) |
| Use a different AI key | `setup --reset-key` |
| Switch Claude model | Edit `ANTHROPIC_MODEL` in `product/backend/wrangler.jsonc` (lowercase name), then run the setup |
| Limit spending further | Lower `AI_PER_DAY` in `product/backend/wrangler.jsonc`, then run the setup |
| Teach it my own material | Add a file to `knowledge/` (see `knowledge/README.md`), then run the setup |
| Remove everything | Delete the Worker and the D1 database in the Cloudflare dashboard, and remove the add-in in Excel |

## If something goes wrong
| What you see | What it means | Fix |
|---|---|---|
| `#NAME?` | Excel has not registered the formulas yet | Wait a minute, reload the page. Still there: remove Formulr under Manage My Add-ins and upload the file again |
| A red banner: "Office.js did not load" | Something is blocking Microsoft's script on this network or browser | Try another network or browser, turn off a VPN or ad blocker. Press **Run checks** in the side bar |
| "Formulr is locked" | You are not unlocked on this device | Click **Formulr** on the Home tab and enter the access code |
| `#VALUE!` with "The AI declined this input" | The AI refused that text | Reword the question |
| `#N/A` with a message about the AI provider | Wrong key, no credit, or a retired model | Check your key and credit. Run `setup --reset-key`. Check the model name |
| "Usage limit reached" | You hit your own daily or per minute limit | Wait, or raise `AI_PER_DAY` / `AI_PER_MINUTE` and run the setup |
| Setup stops with red text | Usually a login or a typo in the key | Read the message, fix, run the setup again. It is safe to repeat |

In the side bar, **Run checks**, **Test the AI** and **Run full self-test** show what your Excel supports and whether everything works. Copy the report if you open an issue. It never contains your access code.

## Questions
**How much does it cost?** Light personal use should fit within Cloudflare's free plan (check their current limits). The AI provider charges per use, and your spending limit is the ceiling.
**Where do my questions go?** To your Worker and then to your AI provider. They are not stored by the Worker, which only counts calls.
**Is the access code safe?** Treat it like a password. Anyone who has it can use your AI credit. Rotate it if it leaks.
**Can I run it without Cloudflare?** Not as written. The Worker is built for Cloudflare Workers.

## Speed

Finished answers are saved in your browser for a week, so reopening a workbook does not ask every question again. To force a fresh answer, change one character of the question or the extra instruction. Eight questions run at once.
