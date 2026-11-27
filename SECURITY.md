# Security

## Reporting a problem
Please report security problems privately with the "Report a vulnerability" button on this repository's Security tab. Do not open a public issue for a vulnerability. Include steps to reproduce and what you expected to happen.

## How your AI key is handled
- Your key is stored only in the add-in on your device. Press **Remove key** in the side bar to delete it.
- Checking a key goes straight from your device to Anthropic or Google.
- Each answer sends the key over a secure connection to the Formulr service, which passes it to your provider for that one call. It is never saved, logged or shown. Usage limits use only a one way scrambled tag of it.
- If you run your own copy, any key you store on your Worker is a Cloudflare secret, never written to this repository or a command line.

## Know the limits
- Set a monthly spending limit with your AI provider.
- Text you send through a formula goes to the AI provider you picked. Do not send data you are not allowed to share.
- This project has not had a formal third party security review.
