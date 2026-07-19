"use client";

import { useRef, useState } from "react";
import { formatPrice } from "@/lib/catalog";

export type ChartPoint = { label: string; value: number; showLabel: boolean };

/**
 * Single-series revenue area+line chart. The plot (area, line, dots, grid) is a
 * scaled SVG; axis labels and the hover readout are HTML overlays so text stays
 * crisp at any width. Hover works on mouse and touch, so the exact value is
 * always reachable, unlike the old bars' desktop-only title tooltips.
 */
export function RevenueChart({ points }: { points: ChartPoint[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const W = 720;
  const H = 220;
  const padX = 6;
  const padT = 14;
  const padB = 8;
  const innerW = W - padX * 2;
  const innerH = H - padT - padB;
  const n = points.length;
  const max = Math.max(1, ...points.map((p) => p.value));

  const x = (i: number) => (n <= 1 ? W / 2 : padX + (i / (n - 1)) * innerW);
  const y = (v: number) => padT + innerH - (v / max) * innerH;
  const xPct = (i: number) => (x(i) / W) * 100;

  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(" ");
  const area = n > 1 ? `${line} L${x(n - 1).toFixed(1)} ${padT + innerH} L${x(0).toFixed(1)} ${padT + innerH} Z` : "";
  const gridYs = [0.5, 1].map((f) => padT + innerH - f * innerH);

  function locate(clientX: number) {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = ((clientX - rect.left) / rect.width) * W;
    let best = 0;
    let bd = Infinity;
    points.forEach((_, i) => {
      const d = Math.abs(x(i) - px);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    setHover(best);
  }

  const active = hover != null ? points[hover] : null;

  return (
    <div
      ref={wrapRef}
      className="relative touch-pan-y select-none"
      onPointerMove={(e) => locate(e.clientX)}
      onPointerDown={(e) => locate(e.clientX)}
      onPointerLeave={() => setHover(null)}
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" preserveAspectRatio="none" style={{ height: "160px" }} aria-hidden="true">
        <defs>
          <linearGradient id="revfill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-rose-deep)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--color-rose-deep)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {gridYs.map((gy, i) => (
          <line key={i} x1={padX} x2={W - padX} y1={gy} y2={gy} stroke="var(--color-line)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        ))}
        {area && <path d={area} fill="url(#revfill)" />}
        {line && (
          <path d={line} fill="none" stroke="var(--color-rose-deep)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        )}
        {hover != null && (
          <line x1={x(hover)} x2={x(hover)} y1={padT} y2={padT + innerH} stroke="var(--color-rose)" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
        )}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={x(i)}
            cy={y(p.value)}
            r={hover === i ? 5 : 3}
            fill={hover === i ? "var(--color-rose-deep)" : "var(--color-white)"}
            stroke="var(--color-rose-deep)"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>

      {/* x-axis labels (crisp HTML, selective) */}
      <div className="relative mt-1 h-4">
        {points.map((p, i) =>
          p.showLabel ? (
            <span
              key={i}
              className="absolute -translate-x-1/2 whitespace-nowrap text-xs text-muted"
              style={{ left: `${Math.min(95, Math.max(5, xPct(i)))}%` }}
            >
              {p.label}
            </span>
          ) : null,
        )}
      </div>

      {/* hover readout */}
      {active && (
        <div
          className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-lg border border-line bg-white px-2.5 py-1.5 text-center shadow-soft"
          style={{ left: `${Math.min(88, Math.max(12, xPct(hover!)))}%` }}
        >
          <p className="text-sm font-semibold text-ink">{formatPrice(active.value)}</p>
          <p className="text-xs text-muted">{active.label}</p>
        </div>
      )}

      {/* The per-point values are otherwise only reachable by pointer hover, so
          mirror them in a visually-hidden table for keyboard and screen readers. */}
      <table className="sr-only">
        <caption>Revenue by day</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Revenue</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p, i) => (
            <tr key={i}>
              <th scope="row">{p.label}</th>
              <td>{formatPrice(p.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
