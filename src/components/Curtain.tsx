"use client";

import { PlanetMark } from "./Logo";

/**
 * The lock curtain. `cover` slides it up over the app when the vault locks,
 * `lift` takes it away when the vault opens or a page arrives, and `hold`
 * keeps it in place while there is nothing to show yet.
 */
export function Curtain({ state, onDone }: { state: "cover" | "lift" | "hold"; onDone?: () => void }) {
  return (
    <div
      className={`curtain${state === "cover" ? " is-cover" : state === "lift" ? " is-lift" : ""}`}
      aria-hidden={state === "lift"}
      role={state === "lift" ? undefined : "status"}
      onAnimationEnd={(e) => {
        if (e.target === e.currentTarget) onDone?.();
      }}
    >
      <PlanetMark />
      {state !== "lift" && <span className="sr-only">{state === "cover" ? "Locking vault" : "Opening vault"}</span>}
    </div>
  );
}
