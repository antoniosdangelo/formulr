import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ShineBorder } from "@/components/magicui/shine-border";

// Walks a new user through getting their own AI key and checks that it works.
// The check goes straight from this browser to the provider. Formulr's server never sees the key here,
// and the page keeps it in memory only, never in storage.

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

// Lists the provider's models with the key. It spends no tokens and costs nothing.
async function askProvider(provider: Provider, key: string): Promise<Response> {
  if (provider === "anthropic") {
    return fetch("https://api.anthropic.com/v1/models?limit=1", {
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
      referrerPolicy: "no-referrer",
    });
  }
  return fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", {
    headers: { "x-goog-api-key": key },
    referrerPolicy: "no-referrer",
  });
}

type Status = { kind: "idle" | "busy" | "ok" | "error"; title: string; text: string };
const IDLE: Status = { kind: "idle", title: "", text: "" };

const Step = ({ n, title, children }: { n: number; title: string; children: React.ReactNode }) => (
  <div className="grid grid-cols-[2rem_1fr] gap-x-3 gap-y-2">
    <span className="flex size-8 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">{n}</span>
    <h3 className="self-center text-base font-semibold">{title}</h3>
    <div className="col-start-2 grid gap-3">{children}</div>
  </div>
);

export default function KeySetup() {
  const [provider, setProvider] = useState<Provider>("anthropic");
  const [key, setKey] = useState("");
  const [show, setShow] = useState(false);
  const [status, setStatus] = useState<Status>(IDLE);
  const [copied, setCopied] = useState(false);
  const guide = GUIDES[provider];

  const onKeyChange = (value: string) => {
    setKey(value);
    setCopied(false);
    setStatus(IDLE);
    const g = guess(value.trim());
    if (g && g !== provider) setProvider(g);
  };

  const fail = (title: string, text: string) => setStatus({ kind: "error", title, text });

  const check = async () => {
    const k = key.trim();
    if (!k) return fail("No key yet", "Paste your key in the box first.");
    if (!/^[\x21-\x7e]{20,400}$/.test(k)) return fail("Not a full key", "Copy it again from your provider.");
    if (!k.startsWith(guide.prefix)) return fail("Wrong kind of key", `${guide.name} keys start with ${guide.prefix}. Check you copied all of it, or pick the other provider.`);
    setStatus({ kind: "busy", title: "", text: "Checking your key..." });
    try {
      const res = await askProvider(provider, k);
      if (res.ok) {
        setStatus({
          kind: "ok",
          title: "Your key works",
          text: provider === "anthropic" ? "Make sure your Anthropic account has credit, or answers will be refused." : "You are ready for Excel.",
        });
      } else if (res.status === 400 || res.status === 401 || res.status === 403) {
        fail("Key not accepted", `${provider === "anthropic" ? "Anthropic" : "Google"} says this key is not valid. Copy it again, or make a new one.`);
      } else if (res.status === 429) {
        fail("Provider is busy", "Try the check again in a minute.");
      } else {
        fail("Could not check", "The provider had a problem. Try again in a minute.");
      }
    } catch {
      fail("Could not reach the provider", "Check your connection and try again.");
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(key.trim());
      setCopied(true);
    } catch {
      setShow(true);
      setStatus({ ...status, text: "Copying was blocked, so select the key in the box and copy it yourself." });
    }
  };

  const clear = () => {
    setKey("");
    setCopied(false);
    setShow(false);
    setStatus(IDLE);
  };

  return (
    <Card className="key-setup relative mt-4 gap-8 overflow-hidden bg-muted">
      <CardContent className="grid gap-8">
        <Step n={1} title="Pick a provider">
          <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="AI provider">
            {(Object.keys(GUIDES) as Provider[]).map((p) => (
              <label
                key={p}
                className={
                  "relative grid cursor-pointer gap-1 rounded-lg border-2 bg-background py-3 pr-3 pl-11 transition-colors focus-within:ring-[3px] focus-within:ring-ring/50 " +
                  (p === provider ? "border-primary bg-accent" : "hover:border-primary/50")
                }
              >
                <input
                  type="radio"
                  name="provider"
                  value={p}
                  checked={p === provider}
                  onChange={() => setProvider(p)}
                  className="absolute top-4 left-4 size-4 accent-[var(--accent)]"
                />
                <span className="font-semibold">{GUIDES[p].name}</span>
                <span className="text-sm text-muted-foreground">{GUIDES[p].tagline}</span>
              </label>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">OpenAI and others are coming later.</p>
        </Step>

        <Step n={2} title="Make your key">
          <ol className="m-0 grid list-decimal gap-1 pl-5">
            {guide.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          <div>
            <a
              href={guide.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-10 items-center rounded-md border bg-background px-4 text-sm font-medium no-underline shadow-xs hover:bg-accent"
            >
              {guide.linkText}
            </a>
          </div>
        </Step>

        <Step n={3} title="Check that it works">
          <label htmlFor="key-input" className="text-sm font-medium">
            Paste your key
          </label>
          <div className="flex flex-wrap gap-2">
            <Input
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
              aria-invalid={status.kind === "error" || undefined}
              className="h-10 min-w-[12rem] flex-1 bg-background font-mono"
            />
            <Button type="button" variant="outline" size="lg" onClick={() => setShow(!show)} aria-pressed={show}>
              {show ? "Hide" : "Show"}
            </Button>
            <Button type="button" size="lg" onClick={check} disabled={status.kind === "busy"}>
              {status.kind === "busy" ? "Checking..." : "Check key"}
            </Button>
          </div>
          <div aria-live="polite" className="grid gap-3">
            {status.kind === "busy" && <p className="m-0 text-sm text-muted-foreground">{status.text}</p>}
            {status.kind === "error" && (
              <Alert variant="destructive">
                <AlertTitle>{status.title}</AlertTitle>
                <AlertDescription>{status.text}</AlertDescription>
              </Alert>
            )}
            {status.kind === "ok" && (
              <Card className="relative gap-4 overflow-hidden py-5">
                <ShineBorder shineColor={["#217346", "#3fae73", "#9be3b8"]} borderWidth={2} />
                <CardHeader className="px-5">
                  <CardTitle className="text-primary">✓ {status.title}</CardTitle>
                  <CardDescription>{status.text}</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 px-5">
                  <h3 className="m-0 text-base font-semibold">Now put it in Excel</h3>
                  <ol className="m-0 grid list-decimal gap-2 pl-5">
                    <li>
                      <Button type="button" size="sm" onClick={copy}>
                        {copied ? "Copied" : "Copy key"}
                      </Button>
                    </li>
                    <li>In Excel, click Formulr on the Home tab.</li>
                    <li>Under Your AI key, paste it and press Save key. Formulr checks it once more and you are done.</li>
                  </ol>
                  <div>
                    <Button type="button" variant="link" className="h-auto px-0" onClick={clear}>
                      Clear the key from this page
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
          <p className="m-0 text-sm text-muted-foreground">
            This page never saves your key. The check goes straight from your browser to your provider, so Formulr never sees it here, and
            it costs nothing. Browsers keep websites and Excel apart for safety, so you paste the key into Excel once yourself.
          </p>
        </Step>
      </CardContent>
    </Card>
  );
}
