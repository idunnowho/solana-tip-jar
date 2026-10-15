import { useEffect, useRef } from "react";
import { multiplierAt } from "./game";

type Phase = "lobby" | "betting" | "flying" | "crashed";

function elapsedFor(multiplier: number) {
  if (multiplier <= 1) return 0;
  return (Math.log(multiplier) / 0.06) * 1000;
}

type ChartProps = {
  phase: Phase;
  multiplier: number;
  crashAt: number | null;
  cashoutAt: number | null;
};

export default function Chart({ phase, multiplier, crashAt, cashoutAt }: ChartProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    let frame = 0;
    let stopped = false;

    const draw = () => {
      if (stopped) return;
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(1, Math.floor(rect.width * devicePixelRatio));
      const height = Math.max(1, Math.floor(rect.height * devicePixelRatio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      const cssWidth = rect.width;
      const cssHeight = rect.height;
      context.clearRect(0, 0, cssWidth, cssHeight);

      context.strokeStyle = "rgba(148, 163, 184, 0.16)";
      context.lineWidth = 1;
      for (let x = 0; x < cssWidth; x += 48) {
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, cssHeight);
        context.stroke();
      }
      for (let y = 0; y < cssHeight; y += 40) {
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(cssWidth, y);
        context.stroke();
      }

      const live = Math.max(1, multiplier);
      const ceiling = Math.max(live, crashAt ?? live, cashoutAt ?? 1, 2);
      const crashed = phase === "crashed";
      const color = crashed ? "#ff4d6d" : "#3dff9a";
      const span = Math.max(elapsedFor(live), 1);

      context.beginPath();
      const steps = 80;
      for (let i = 0; i <= steps; i += 1) {
        const progress = i / steps;
        const value = multiplierAt(span * progress);
        const x = 28 + progress * (cssWidth - 56);
        const y = cssHeight - 28 - ((value - 1) / (ceiling - 1 || 1)) * (cssHeight - 64);
        if (i === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.strokeStyle = color;
      context.lineWidth = 3;
      context.shadowColor = color;
      context.shadowBlur = 18;
      context.stroke();
      context.shadowBlur = 0;

      if (cashoutAt && cashoutAt <= live && phase !== "betting") {
        const progress = (cashoutAt - 1) / (live - 1 || 1);
        const x = 28 + Math.min(1, progress) * (cssWidth - 56);
        const y = cssHeight - 28 - ((cashoutAt - 1) / (ceiling - 1 || 1)) * (cssHeight - 64);
        context.fillStyle = "#f5d76e";
        context.beginPath();
        context.arc(x, y, 5, 0, Math.PI * 2);
        context.fill();
      }

      frame = requestAnimationFrame(draw);
    };

    frame = requestAnimationFrame(draw);
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
    };
  }, [cashoutAt, crashAt, multiplier, phase]);

  return <canvas ref={canvasRef} className="chart" aria-hidden="true" />;
}
