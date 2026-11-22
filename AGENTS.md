# Who works on what

Every pull request names its owner agent, so you always know which chat to open.

| Part | Owner agent |
|---|---|
| `backend/` | Formulr Builder |
| `frontend/` | Formulr Builder |
| `docs/` | Formulr Builder |
| repo setup (.github/, .env layout, BRANCHING, AGENTS) | Orchestrator |

## How to open an agent
- In VS Code (folder `C:\Dev\Claude Code`): Ctrl+Shift+P, "Tasks: Run Task", then **Agent: Formulr Builder** (or **Agent: Orchestrator**).
- The chat ids are in this project's local `.env` under CLAUDE CHATS.

## Labels on GitHub
- `agent: ...` says who owns the pull request.
- `side: backend` or `side: frontend` says which form it is. Backend forms are merged first.

## The path every change takes
Work branch (`backend/...` or `frontend/...`) to a pull request into `sandbox`, checks run, then a backend form and a frontend form into `main`. Merged automatically once checks pass. A live deploy always needs Antonio's typed "deploy". See `BRANCHING.md`.
