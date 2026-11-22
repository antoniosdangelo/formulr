import { useState } from "react";

const FORMULA = "=FORMULR.ANSWER(B2)";

const providers = [
  { name: "Anthropic (Claude)", status: "Supported", href: "https://console.anthropic.com/settings/keys" },
  { name: "Google Gemini", status: "Supported", href: "https://aistudio.google.com/apikey" },
  { name: "OpenAI and others", status: "Not yet", href: "" },
];

const faq = [
  {
    q: "Do I need an account with Formulr?",
    a: "No. There is no sign up and no access code. You need Excel and an AI key from Anthropic or Google Gemini.",
  },
  {
    q: "Who pays for the answers?",
    a: "You do, through your own AI account. Each question uses one call on your key. Set a monthly spending limit with your provider before you start.",
  },
  {
    q: "Does it work in desktop Excel?",
    a: "Yes, in Excel on the web and in desktop Excel with any Microsoft account. An uploaded add-in is remembered per browser, so repeat step 2 on a new browser or laptop.",
  },
  {
    q: "What if I see #NAME?",
    a: "Wait a minute, then reload the page or reopen the workbook. If it stays, remove older Formulr entries in Manage My Add-ins and upload the file again.",
  },
  {
    q: "Can it read pictures?",
    a: "Yes. Click a floating picture and press Answer picture in the Formulr pane, or paste a screenshot into the paste box there.",
  },
  {
    q: "How do I get help?",
    a: "In the Formulr pane press Run checks, then Copy, and send the report to whoever helps you. It never includes your AI key.",
  },
];

function CopyFormula() {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(FORMULA);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked: the formula is still on screen to copy by hand */
    }
  };
  return (
    <button type="button" className="ghost" onClick={copy} aria-live="polite">
      {copied ? "Copied" : "Copy formula"}
    </button>
  );
}

function Demo() {
  return (
    <figure className="demo" aria-label="Example: a question in B2 and its answer in C2">
      <div className="formula-bar">
        <span className="fx">fx</span>
        <code>{FORMULA}</code>
      </div>
      <table className="sheet">
        <thead>
          <tr>
            <th scope="col" aria-hidden="true"></th>
            <th scope="col">B</th>
            <th scope="col">C</th>
            <th scope="col">D</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">2</th>
            <td>A train leaves at 3:15 PM and drives 180 miles at 60 mph. When does it arrive?</td>
            <td className="answer">6:15 PM</td>
            <td className="explain">180 miles at 60 mph is 3 hours after 3:15 PM.</td>
          </tr>
        </tbody>
      </table>
      <figcaption>The answer fills the cell, and a one line explanation fills the next one.</figcaption>
    </figure>
  );
}

export default function App() {
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="top">
        <div className="wrap bar">
          <span className="brand">
            <img src="/icon-32.png" width="24" height="24" alt="" />
            Formulr
          </span>
          <a className="cta small" href="download">
            Get the add-in
          </a>
        </div>
      </header>

      <main id="main">
        <section className="hero wrap">
          <div className="hero-text">
            <h1>AI answers inside your Excel formulas</h1>
            <p className="lead">
              Type a question in a cell, then <code>{FORMULA}</code> next to it. Formulr runs on <strong>your own AI key</strong>, so your
              answers are yours and so is the bill.
            </p>
            <div className="actions">
              <a className="cta" href="download">
                Download the add-in
              </a>
              <CopyFormula />
            </div>
            <p className="note">Free to install. Works in Excel on the web and desktop. No sign up, no access code.</p>
          </div>
          <Demo />
        </section>

        <section className="wrap" aria-labelledby="promise-title">
          <div className="key-promise">
            <h2 id="promise-title">You use your own AI key</h2>
            <ul>
              <li>Formulr never uses anyone else's AI key. You paste your own, and your own AI account pays for your answers.</li>
              <li>Your key stays on your device. It is sent over a secure connection with each answer and is never saved on the server.</li>
              <li>Without your own key, Formulr gives no answers. There is no shared key to fall back on.</li>
              <li>Press Remove key in the Formulr pane to delete it from your device at any time.</li>
            </ul>
          </div>
        </section>

        <section className="wrap" aria-labelledby="steps-title">
          <h2 id="steps-title">Set up in three steps</h2>
          <ol className="steps">
            <li>
              <h3>Get the add-in</h3>
              <p>
                <a href="download">Download formulr-manifest.xml</a>. It is a small file that tells Excel where Formulr lives.
              </p>
            </li>
            <li>
              <h3>Upload it in Excel</h3>
              <p>
                In <a href="https://excel.cloud.microsoft/" target="_blank" rel="noopener">Excel</a> open any workbook, then go to Insert, Add-ins,
                More Add-ins, My Add-ins, Manage My Add-ins, Upload My Add-in, and choose the file.
              </p>
            </li>
            <li>
              <h3>Add your AI key</h3>
              <p>
                Click <strong>Formulr</strong> on the Home tab. Under <strong>Your AI key</strong>, pick your provider, paste your key and press Save
                key. Then type <code>{FORMULA}</code> next to a question.
              </p>
            </li>
          </ol>
        </section>

        <section className="wrap" aria-labelledby="providers-title">
          <h2 id="providers-title">Supported providers</h2>
          <div className="table-scroll">
            <table className="providers">
              <thead>
                <tr>
                  <th scope="col">Provider</th>
                  <th scope="col">Status</th>
                  <th scope="col">Get a key</th>
                </tr>
              </thead>
              <tbody>
                {providers.map((p) => (
                  <tr key={p.name}>
                    <td>{p.name}</td>
                    <td>{p.status}</td>
                    <td>
                      {p.href ? (
                        <a href={p.href} target="_blank" rel="noopener">
                          Get a key
                        </a>
                      ) : (
                        <span className="muted">Coming later</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="wrap" aria-labelledby="faq-title">
          <h2 id="faq-title">Questions</h2>
          <div className="faq">
            {faq.map((item) => (
              <details key={item.q}>
                <summary>{item.q}</summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="wrap" aria-labelledby="privacy-title">
          <h2 id="privacy-title">Privacy</h2>
          <ul className="plain">
            <li>Your questions go to the AI provider you picked, and only to answer them. Formulr keeps no copy of your questions or answers on the server.</li>
            <li>Your AI key is kept in the add-in's storage in your browser. The server uses it for one call and never logs or stores it.</li>
            <li>Finished answers are kept in your browser for a week so reopening a workbook does not ask again.</li>
            <li>Do not send data you are not allowed to share, such as confidential company files, until you have approval.</li>
          </ul>
        </section>
      </main>

      <footer className="wrap foot">
        <p>
          <a href="manifest.xml">Manifest</a> · <a href="download">Download</a>
        </p>
        <p className="muted">Not affiliated with or endorsed by Microsoft, Anthropic, Google or Cloudflare. Excel is a trademark of Microsoft.</p>
      </footer>
    </>
  );
}
