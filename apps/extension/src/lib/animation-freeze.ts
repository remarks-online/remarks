import { sidebarStore } from "@/lib/sidebar-store";

export const FREEZE_STYLE_ID = "rmk-animation-freeze";

const FREEZE_CSS =
  "*, *::before, *::after { animation-play-state: paused !important; transition: none !important; }";

const pausedAnimations = new Set<Animation>();

export function applyFreeze(doc: Document = document): void {
  if (doc.getElementById(FREEZE_STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = FREEZE_STYLE_ID;
  style.textContent = FREEZE_CSS;
  (doc.head ?? doc.documentElement).appendChild(style);

  // jsdom doesn't implement Document.getAnimations(); the guard keeps unit
  // tests green and only the Chromium build exercises the JS-animation pause.
  if (typeof doc.getAnimations === "function") {
    for (const anim of doc.getAnimations()) {
      if (anim.playState === "running") {
        anim.pause();
        pausedAnimations.add(anim);
      }
    }
  }
}

export function releaseFreeze(doc: Document = document): void {
  doc.getElementById(FREEZE_STYLE_ID)?.remove();
  for (const anim of pausedAnimations) {
    try {
      anim.play();
    } catch {
      // Animation may have finalized between pause and resume.
    }
  }
  pausedAnimations.clear();
}

export function initAnimationFreezeController(): () => void {
  let prevEffective = false;
  const sync = (): void => {
    const s = sidebarStore.getState();
    const effective = s.visible && s.freezeAnimations;
    if (effective === prevEffective) return;
    prevEffective = effective;
    if (effective) applyFreeze();
    else releaseFreeze();
  };
  sync();
  const unsub = sidebarStore.subscribe(sync);
  return () => {
    unsub();
    releaseFreeze();
    prevEffective = false;
  };
}
