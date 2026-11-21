# Security

## Reporting a problem
Please report security problems privately through GitHub's "Report a vulnerability" button on the Security tab of this repository.
Do not open a public issue for a vulnerability. Include steps to reproduce and what you expected to happen.

## How the project handles secrets
- Your AI key and access code are stored only as Cloudflare Worker secrets in your own account. They are never written to the repository, to disk by the setup script, or to a command line.
- The add-in in Excel never sees your AI key. It holds a signed, expiring pass that the Worker issues after you enter the access code.
- Rotating the access code (`setup --rotate-code`) signs out every device at once.

## Know the limits
- The access code is one shared secret. Anyone who has it can spend your AI credit, so set a monthly spending limit with your AI provider and keep the Worker's usage limits low.
- Text you send through a formula goes to the AI provider you configured. Do not send data you are not allowed to share.
- This project has not had a formal third party security review.
