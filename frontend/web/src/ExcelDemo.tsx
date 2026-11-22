import { useEffect, useState } from "react";

// A looping, Excel style demo: a question is pasted into B2, =FORMULR.ANSWER(B2) is typed into C2,
// and the answer and a one line reason appear. Pure React and CSS, no video file.
// The server render shows the finished sheet, so the page reads fine without JavaScript or with reduced motion.

const QUESTION = "A train leaves at 3:15 PM and drives 180 miles at 60 mph. When does it arrive?";
const FORMULA = "=FORMULR.ANSWER(B2)";
const ANSWER = "6:15 PM";
const WHY = "180 miles at 60 mph takes 3 hours, so 3:15 PM plus 3 hours.";

type Frame = {
  sel: string; // selected cell, like "C2"
  question: boolean; // B2 filled
  typed: number; // characters of the formula typed into C2
  editing: boolean; // C2 is being edited
  thinking: boolean;
  answered: boolean;
  pasteHint: boolean;
  ribbonHint: boolean;
};

const FINAL: Frame = { sel: "C2", question: true, typed: FORMULA.length, editing: false, thinking: false, answered: true, pasteHint: false, ribbonHint: false };
const START: Frame = { sel: "A1", question: false, typed: 0, editing: false, thinking: false, answered: false, pasteHint: false, ribbonHint: false };

// The timeline, as [time in ms, change to the frame].
function timeline(): Array<[number, Partial<Frame>]> {
  const steps: Array<[number, Partial<Frame>]> = [
    [0, START],
    [700, { sel: "B2" }],
    [1300, { pasteHint: true }],
    [1700, { question: true }],
    [2600, { pasteHint: false, sel: "C2" }],
  ];
  let t = 3200;
  for (let i = 1; i <= FORMULA.length; i++) {
    steps.push([t, { typed: i, editing: true }]);
    t += i === 1 ? 260 : 110;
  }
  t += 500;
  steps.push([t, { editing: false, thinking: true, sel: "C3" }]);
  t += 1700;
  steps.push([t, { thinking: false, answered: true }]);
  t += 600;
  steps.push([t, { sel: "C2", ribbonHint: true }]);
  t += 3600;
  steps.push([t, { ribbonHint: false }]);
  return steps;
}

export const DEMO_LENGTH_MS = 13000;

const COLS = ["A", "B", "C", "D", "E"];
const ROWS = [1, 2, 3, 4, 5, 6];

export default function ExcelDemo() {
  const [f, setF] = useState<Frame>(FINAL);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let timers: number[] = [];
    const run = () => {
      let frame = { ...START };
      timers = timeline().map(([at, change]) =>
        window.setTimeout(() => {
          frame = { ...frame, ...change };
          setF(frame);
        }, at),
      );
      timers.push(window.setTimeout(run, DEMO_LENGTH_MS));
    };
    run();
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, []);

  const typedText = FORMULA.slice(0, f.typed);
  const showAuto = f.editing && f.typed >= 4 && f.typed < 16;
  const showRef = f.editing && f.typed >= 17;
  const barText = f.sel === "B2" && f.question ? QUESTION : f.sel === "C2" && f.typed > 0 ? typedText : "";
  const c2 =
    f.editing ? (
      <span className="xl-edit">
        {renderFormula(typedText)}
        <span className="xl-caret" />
      </span>
    ) : f.thinking ? (
      <span className="xl-busy">Thinking...</span>
    ) : f.answered ? (
      <strong className="xl-answer">{ANSWER}</strong>
    ) : null;

  const cell = (id: string) => {
    if (id === "B1") return <b>Question</b>;
    if (id === "C1") return <b>Answer</b>;
    if (id === "D1") return <b>Why</b>;
    if (id === "B2") return f.question ? <span className={f.pasteHint ? "" : "xl-fade"}>{QUESTION}</span> : null;
    if (id === "C2") return c2;
    if (id === "D2") return f.answered ? <span className="xl-fade xl-why">{WHY}</span> : null;
    return null;
  };

  const selCol = f.sel[0];
  const selRow = Number(f.sel.slice(1));

  return (
    <figure className="xl" aria-label="Demo: a question is pasted in B2, =FORMULR.ANSWER(B2) is typed in C2, and the answer appears">
      <div className="xl-title" aria-hidden="true">
        <span className="xl-dots">
          <i />
          <i />
          <i />
        </span>
        <span>Book1</span>
        <span className="xl-title-right">Formulr demo</span>
      </div>
      <div className="xl-tabs" aria-hidden="true">
        {["File", "Home", "Insert", "Formulas", "Data", "View"].map((t) => (
          <span key={t} className={t === "Home" ? "on" : ""}>
            {t}
          </span>
        ))}
      </div>
      <div className="xl-ribbon" aria-hidden="true">
        <span className="xl-group" />
        <span className="xl-group wide" />
        <span className="xl-group" />
        <span className={"xl-formulr" + (f.ribbonHint ? " glow" : "")}>
          <img src="/icon-32.png" width="18" height="18" alt="" />
          Formulr
        </span>
      </div>
      <div className="xl-bar" aria-hidden="true">
        <span className="xl-name">{f.sel}</span>
        <span className="xl-fx">fx</span>
        <span className="xl-bar-text">{barText.startsWith("=") ? renderFormula(barText) : barText}</span>
      </div>
      <div className="xl-grid-wrap">
        <table className="xl-grid">
          <thead>
            <tr>
              <th className="xl-corner" />
              {COLS.map((c) => (
                <th key={c} className={c === selCol ? "hl" : ""} scope="col">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r} className={r === 2 ? "tall" : ""}>
                <th scope="row" className={r === selRow ? "hl" : ""}>
                  {r}
                </th>
                {COLS.map((c) => {
                  const id = c + r;
                  const cls = ["xl-c" + c, id === f.sel ? "sel" : "", id === "B2" && showRef ? "ref" : "", id === "B2" && f.pasteHint ? "paste" : ""]
                    .filter(Boolean)
                    .join(" ");
                  return (
                    <td key={id} className={cls}>
                      {cell(id)}
                      {id === "C2" && showAuto && (
                        <span className="xl-auto">
                          <span className="on">ƒx FORMULR.ANSWER</span>
                        </span>
                      )}
                      {id === "B2" && f.pasteHint && <span className="xl-chip">Ctrl+V</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="xl-sheets" aria-hidden="true">
        <span className="on">Sheet1</span>
        <span className="xl-ready">{f.thinking ? "Calculating..." : "Ready"}</span>
      </div>
    </figure>
  );
}

// Colours the B2 reference in the formula, the way Excel does while you type.
function renderFormula(text: string) {
  const i = text.indexOf("B2");
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <span className="xl-refword">B2</span>
      {text.slice(i + 2)}
    </>
  );
}
