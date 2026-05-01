import { annotationStore, useAnnotationUi } from "@/lib/annotation-store";
import { cn } from "@remarks/ui";
import type { CSSProperties } from "react";

interface Props {
  annotationId: string;
  // Center of the pin in viewport coords (already translated from doc coords).
  cx: number;
  cy: number;
  // Size in CSS pixels for the rendered SVG (the original viewBox is 512x512).
  size?: number;
}

export function AnnotationPin({ annotationId, cx, cy, size = 48 }: Props) {
  const hovered = useAnnotationUi((s) => s.hoveredAnnotationId === annotationId);

  const style: CSSProperties = {
    // Anchor the pin tip at (cx, cy). The tip sits at viewBox (256, 390) — ~50%
    // horizontally, ~76% vertically through a 512 box — so translate(-50%, -76%).
    transform: `translate3d(${Math.round(cx)}px, ${Math.round(cy)}px, 0) translate(-50%, -76%)`,
    transformOrigin: "50% 76%",
  };

  return (
    <button
      type="button"
      data-remarks-pin={annotationId}
      data-hovered={hovered ? "true" : "false"}
      aria-label="Open annotation"
      onMouseEnter={() => annotationStore.getState().setHovered(annotationId)}
      onMouseLeave={() => annotationStore.getState().setHovered(null)}
      onClick={(e) => {
        e.stopPropagation();
        annotationStore.getState().setSelected(annotationId);
      }}
      className={cn(
        "pointer-events-auto absolute top-0 left-0 cursor-pointer border-0 bg-transparent p-0 drop-shadow-md",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      )}
      style={style}
    >
      <PinSvg size={size} hovered={hovered} />
    </button>
  );
}

function PinSvg({ size, hovered }: { size: number; hovered: boolean }) {
  // Two color states. Default uses the brand purple from the design asset;
  // hover bumps the saturation and swaps the body fill so the marker reads as
  // "active" without needing extra DOM.
  const stroke = hovered ? "#3F39C7" : "#5B54E8";
  const bodyFill = hovered ? "#EEEDFE" : "#FFFFFF";
  const dotFill = hovered ? "#3F39C7" : "#5B54E8";
  const dotRing = hovered ? "#8B85F1" : "#B7BDF8";

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M256 390C273.673 390 288 375.673 288 358C288 340.327 273.673 326 256 326C238.327 326 224 340.327 224 358C224 375.673 238.327 390 256 390Z"
        fill={bodyFill}
        stroke={dotRing}
        strokeWidth="8"
      />
      <path
        d="M256 371C263.18 371 269 365.18 269 358C269 350.82 263.18 345 256 345C248.82 345 243 350.82 243 358C243 365.18 248.82 371 256 371Z"
        fill={dotFill}
      />
      <path
        d="M256 94C204.084 94 162 136.084 162 188C162 222.502 180.602 252.66 208.3 268.92L256 330L303.7 268.92C331.398 252.66 350 222.502 350 188C350 136.084 307.916 94 256 94Z"
        fill={bodyFill}
        stroke={stroke}
        strokeWidth="14"
        strokeLinejoin="round"
      />
      <path d="M210 165H302" stroke={stroke} strokeWidth="14" strokeLinecap="round" />
      <path d="M210 197H302" stroke={stroke} strokeWidth="14" strokeLinecap="round" />
      <path d="M210 229H266" stroke={stroke} strokeWidth="14" strokeLinecap="round" />
    </svg>
  );
}
