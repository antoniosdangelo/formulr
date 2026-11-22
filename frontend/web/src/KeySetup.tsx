import { useState } from "react";

// Walks a new user through getting their own AI key and checks that it works.
// The key only lives in this page's memory while it is open. It is never saved here, and the check spends nothing.

type Provider = "anthropic" | "gemini";

const GUIDES: Record<Provider, { name: string; tagline: string; prefix: string; href: string; linkText: string; steps: string[] }> = {
  anthropic: {
    name: "Anthropic (Claude)",
    tagline: "Strong answers. Pay as you go with prepaid credit.",
    prefix: "sk-ant-",
    href: "https://console.anthropic.com/settings/keys",
    linkText: "Open the Anthropic keys page",
    steps: [
      "Open the Anthropic keys page and sign in, or make a free account.",
      "Under Billing, add a few dollars of credit and set a monthly spend limit.",
      "Back on API keys, press Create Key and name it Formulr.",
      "Copy the key right away. It starts with sk-ant- and is shown only once.",
    ],
  },
  gemini: {
    name: "Google Gemini",
    tagline: "Quick to set up with a Google account. Has a free tier with lower limits.",
    prefix: "AIza",
    href: "https://aistudio.google.com/apikey",
    linkText: "Open Google AI Studio",
    steps: [
      "Open Google AI Studio and sign in with your Google account.",
      "Press Create API key and pick or create a project.",
      "Copy the key. It starts with AIza.",
    ],
  },
};

const guess = (key: string): Provider | null => (key.startsWith("sk-ant-") ? "anthropic" : key.startsWith("AIza") ? "gemini" : null);

type Status = { kind: "idle" | "busy" | "ok" | "error"; text: string };

export default function KeySetup() {
  const [provider, setProvider] = useState<Provider>("anthropic");
  const [key, setKey] = useState("");
  const [show, setShow] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle", text: "" });
  const [copied, setCopied] = useState(false);
  const guide = GUIDES[provider];

  const onKeyChange = (value: string) => {
    setKey(value);
    setCopied(false);
    setStatus({ kind: "idle", text: "" });
    const g = guess(value.trim());
    if (g && g !== provider) setProvider(g);
  };

  const check = async () => {
    const k = key.trim();
    if (!k) return setStatus({ kind: "error", text: "Paste your key in the box first." });
    if (!/^[\x21-\x7e]{20,400}$/.test(k)) return setStatus({ kind: "error", text: "That does not look like a full key. Copy it again from your provider." });
    if (!k.startsWith(guide.prefix)) {
      return setStatus({ kind: "error", text: `${guide.name} keys start with ${guide.prefix}. Check that you copied the whole key, or pick the other provider.` });
    }
    setStatus({ kind: "busy", text: "Checking your key..." });
    try {
      const res = await fetch("/api/key-check", {
        method: "POST",
        headers: { "content-type": "application/json", "x-formulr-provider": provider, "x-formulr-key": k },
        body: "{}",
      });
      const body = await res.json().catch(() => null);
      if (res.ok && body?.ok) {
        setStatus({
          kind: "ok",
          text:
            provider === "anthropic"
              ? "Your key works. Make sure your Anthropic account has credit, or answers will be refused."
              : "Your key works.",
        });
      } else {
        setStatus({ kind: "error", text: body?.message ?? "The key could not be checked right now. Try again in a minute." });
      }
    } catch {
      setStatus({ kind: "error", text: "Could not reach Formulr to check the key. Check your connection and try again." });
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(key.trim());
      setCopied(true);
    } catch {
      setStatus({ kind: "ok", text: "Your key works. Copying was blocked, so select the key in the box and copy it yourself." });
    }
  };

  const clear = () => {
    setKey("");
    setCopied(false);
    setStatus({ kind: "idle", text: "" });
  };

  return (
    <div className="key-setup">
      <fieldset className="pick">
        <legend>1. Pick a provider</legend>
        <div className="pick-grid">
          {(Object.keys(GUIDES) as Provider[]).map((p) => (
            <label key={p} className={"pick-card" + (p === provider ? " on" : "")}>
              <input type="radio" name="provider" value={p} checked={p === provider} onChange={() => setProvider(p)} />
              <span className="pick-name">{GUIDES[p].name}</span>
              <span className="pick-tag">{GUIDES[p].tagline}</span>
            </label>
          ))}
        </div>
        <p className="muted small">OpenAI and others are coming later.</p>
      </fieldset>

      <div className="how">
        <h3>2. Make your key</h3>
        <ol>
          {guide.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        <a className="ghost" href={guide.href} target="_blank" rel="noopener">
          {guide.linkText}
        </a>
      </div>

      <div className="paste">
        <h3>3. Check that it works</h3>
        <label htmlFor="key-input">Paste your key</label>
        <div className="paste-row">
          <input
            id="key-input"
            type={show ? "text" : "password"}
            autoComplete="off"
            spellCheck={false}
            placeholder={guide.prefix + "..."}
            value={key}
            onChange={(e) => onKeyChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") check();
            }}
          />
          <button type="button" className="ghost" onClick={() => setShow(!show)} aria-pressed={show}>
            {show ? "Hide" : "Show"}
          </button>
          <button type="button" className="cta" onClick={check} disabled={status.kind === "busy"}>
            Check key
          </button>
        </div>
        <p className={"key-status " + status.kind} role="status" aria-live="polite">
          {status.text}
        </p>

        {status.kind === "ok" && (
          <div className="next">
            <h3>4. Put it in Excel</h3>
            <ol>
              <li>
                <button type="button" className="cta small" onClick={copy}>
                  {copied ? "Copied" : "Copy key"}
                </button>
              </li>
              <li>In Excel, click Formulr on the Home tab.</li>
              <li>Under Your AI key, paste it and press Save key. Formulr checks it once more and you are done.</li>
            </ol>
            <button type="button" className="link" onClick={clear}>
              Clear the key from this page
            </button>
          </div>
        )}
        <p className="muted small">
          This page never saves your key, and the check costs nothing. Browsers keep websites and Excel apart for safety, so you paste the key
          into Excel once yourself.
        </p>
      </div>
    </div>
  );
}
