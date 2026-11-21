# Knowledge packs

Teach the model your own material (course notes, a formula sheet, house style, a glossary) without training anything.
Put plain text or Markdown files in this folder. They are added to the model's instructions automatically.

## How it works
- `scripts/build-knowledge.mjs` bundles every `.md` or `.txt` file here (except this README) into the Worker.
  It runs by itself when you use `npm test`, `npm run deploy` or `setup`.
- The model sees a pack along with a question. Everything in a pack is sent to your AI provider with each matching question.
- Packs are cached by the provider, so repeated questions cost less and answer faster.

## Choosing when a pack is used
Start the file with one line that holds a regular expression. The pack is added only when the question matches it (case insensitive):

    triggers: \b(bond|coupon|yield)\b

With no `triggers:` line, the pack is added to every question.

## Tips
- Keep a pack under about 20,000 characters. Shorter is faster and cheaper.
- Put your conventions first ("coupons are annual unless stated"), then formulas, then a few worked examples with checked numbers.
- Check every number yourself. The model will trust what you write.
- Do not paste copyrighted material you may not share, and do not include secrets.

## Privacy
Packs you add stay on your machine and your Cloudflare account. Everything in this folder except this README and the `example-` files is
ignored by git, so it will not be committed to a public repository.
