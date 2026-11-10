/** Where you are in selling a call: one numbered segment per step, the chosen value under each step already done.
 *  Shared by the Sell flow (steps 1–6) and the Deposit page (step 7). */
export const SELL_STEPS = ["Size", "Strike", "Expiry", "Premium", "Address", "Review", "Deposit"] as const;

export interface StepItem { label: string; value?: string; onClick?: () => void }

export function SellSteps({ current, items }: { current: number; items: StepItem[] }) {
  const total = items.length, now = items[current - 1];
  return (
    <nav aria-label="Steps to sell a call" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="label" style={{ textTransform: "uppercase", color: "var(--ink-muted)" }}>
        Step <span className="cv-mono">{current}</span> of <span className="cv-mono">{total}</span> · <span style={{ color: "var(--ink)" }}>{now?.label}</span>
      </div>
      <ol className="cv-steps" style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }}>
        {items.map((it, i) => {
          const n = i + 1, state = n < current ? "done" : n === current ? "now" : "todo";
          const body = (
            <>
              <span className="cv-step__n" aria-hidden="true">{state === "done" ? "✓" : n}</span>
              <span className="cv-step__text">
                <span className="cv-step__label">{it.label}</span>
                {state === "done" && it.value && <span className="cv-step__val">{it.value}</span>}
              </span>
            </>
          );
          return (
            <li key={it.label} className={`cv-step cv-step--${state}`} aria-current={state === "now" ? "step" : undefined}>
              {it.onClick && state !== "now"
                ? <button type="button" className="cv-step__hit" onClick={it.onClick} aria-label={`Step ${n}: ${it.label}${it.value ? `, ${it.value}` : ""}. Change`}>{body}</button>
                : <span className="cv-step__hit">{body}</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
