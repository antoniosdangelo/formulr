import ExcelDemo from "./ExcelDemo";
import KeySetup from "./KeySetup";

const FORMULA = "=FORMULR.ANSWER(B2)";

const faq = [
  {
    q: "Do I need an account with Formulr?",
    a: "No. There is no sign up and no access code. You need Excel and an AI key from Anthropic or Google Gemini.",
  },
  {
    q: "Who pays for the answers?",
    a: "You do, through your own AI account. Each question is one call on your key. Set a monthly spending limit with your provider first.",
  },
  {
    q: "Does it work in desktop Excel?",
    a: "Yes, in Excel on the web and in desktop Excel. An uploaded add-in is remembered per browser, so repeat step 2 on a new browser or laptop.",
  },
  {
    q: "What if I see #NAME?",
    a: "Wait a minute, then reload the workbook. If it stays, remove older Formulr entries in Manage My Add-ins and upload the file again.",
  },
  {
    q: "How do I get help?",
    a: "In the Formulr pane press Run checks, then Copy, and send the report to whoever helps you. It never includes your AI key.",
  },
];

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
          <nav className="nav">
            <a href="#how">How it works</a>
            <a href="#get-key">Get a key</a>
            <a className="cta small" href="download">
              Get the add-in
            </a>
          </nav>
        </div>
      </header>

      <main id="main">
        <section className="hero wrap">
          <h1>Ask a question in a cell. Get the answer in the next one.</h1>
          <p className="lead">
            Paste a question into Excel, type <code>{FORMULA}</code> next to it, and the answer appears. Formulr runs on your own AI key.
          </p>
          <div className="actions">
            <a className="cta" href="download">
              Download the add-in
            </a>
            <a className="ghost" href="#how">
              See how it works
            </a>
          </div>
          <ExcelDemo />
        </section>

        <section className="wrap" id="how" aria-labelledby="steps-title">
          <p className="key-promise">
            Formulr never uses anyone else's AI key. Your key stays on your device and is never saved on our server.
          </p>
          <h2 id="steps-title">Set up in three steps</h2>
          <ol className="steps">
            <li>
              <h3>Get the add-in</h3>
              <p>
                <a href="download">Download formulr-manifest.xml</a>, a small file that tells Excel where Formulr lives.
              </p>
            </li>
            <li>
              <h3>Upload it in Excel</h3>
              <p>
                In <a href="https://excel.cloud.microsoft/" target="_blank" rel="noopener">Excel</a>, go to Insert, Add-ins, More Add-ins, My
                Add-ins, Manage My Add-ins, Upload My Add-in, and pick the file.
              </p>
            </li>
            <li>
              <h3>Add your AI key</h3>
              <p>
                <a href="#get-key">Get and check your key</a> below, then paste it in the Formulr pane under <strong>Your AI key</strong>.
              </p>
            </li>
          </ol>
        </section>

        <section className="wrap" id="watch" aria-labelledby="watch-title">
          <h2 id="watch-title">Watch the setup</h2>
          <p className="muted">From install to first answer in under 30 seconds.</p>
          <video className="walkthrough" controls preload="none" playsInline poster="/media/formulr-onboarding.jpg" width="1280" height="720">
            <source src="/media/formulr-onboarding.mp4" type="video/mp4" />
          </video>
        </section>

        <section className="wrap" id="get-key" aria-labelledby="get-key-title">
          <h2 id="get-key-title">Get your AI key</h2>
          <p className="muted">Formulr only works with your own key. It takes about two minutes, once.</p>
          <KeySetup />
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
            <li>Your key stays on your device. Each answer sends it over a secure connection for that one call. It is never logged or stored.</li>
            <li>Your questions go only to the AI provider you picked. Formulr keeps no copy of questions or answers.</li>
            <li>Do not send data you are not allowed to share, such as confidential company files.</li>
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
