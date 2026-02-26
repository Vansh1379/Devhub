import React, { useEffect, useRef } from "react";

const SKY_TOP = "#0f0e1a";
const SKY_BOTTOM = "#1a1a2e";
const MOON_COLOR = "#f4f1de";
const MOON_GLOW = "rgba(244, 241, 222, 0.15)";
const STAR_COLOR = "#e8e6e3";
const CLOUD_COLORS = ["#2d3a4f", "#3d4f6f", "#4a5f7a", "#5a6f8a"];
const BIRD_COLOR = "rgba(255, 255, 255, 0.2)";
const DOG_COLOR = "rgba(255, 255, 255, 0.22)";

function makeDogs(
  count: number,
  width: number,
  height: number,
): {
  x: number;
  y: number;
  speed: number;
  runPhase: number;
  size: number;
  seed: number;
  right: boolean;
}[] {
  const out: {
    x: number;
    y: number;
    speed: number;
    runPhase: number;
    size: number;
    seed: number;
    right: boolean;
  }[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      x: Math.random() * width,
      y: height * (0.5 + Math.random() * 0.4),
      speed: 45 + Math.random() * 35,
      runPhase: Math.random() * Math.PI * 2,
      size: 0.8 + Math.random() * 0.4,
      seed: i * 11,
      right: Math.random() > 0.5,
    });
  }
  return out;
}

function drawDog(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  runPhase: number,
  size: number,
  goingRight: boolean,
) {
  const dir = goingRight ? 1 : -1;
  const s = 12 * size;
  const legCycle = Math.sin(runPhase * 2) * 0.5 + 0.5;
  const legCycle2 = Math.sin(runPhase * 2 + Math.PI) * 0.5 + 0.5;
  ctx.strokeStyle = DOG_COLOR;
  ctx.fillStyle = DOG_COLOR;
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  ctx.save();
  ctx.translate(x, y);
  if (!goingRight) ctx.scale(-1, 1);

  ctx.beginPath();
  ctx.ellipse(s * 0.8, 0, s * 1.1, s * 0.5, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(s * 1.9, -s * 0.1, s * 0.45, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(s * 1.85, -s * 0.5);
  ctx.lineTo(s * 2.1, -s * 0.7);
  ctx.lineTo(s * 2.15, -s * 0.45);
  ctx.stroke();

  const legY = s * 0.35;
  const legH = s * 0.5;
  [
    [s * 0.5, legCycle],
    [s * 1.1, legCycle2],
    [s * 0.2, legCycle2],
    [s * 0.8, legCycle],
  ].forEach(([lx, t]) => {
    const lift = (1 - t) * legH * 0.6;
    ctx.beginPath();
    ctx.moveTo(lx, legY);
    ctx.lineTo(lx + dir * 4, legY + legH - lift);
    ctx.stroke();
  });

  ctx.beginPath();
  ctx.moveTo(-s * 0.3, 0);
  ctx.lineTo(-s * 0.6 - Math.sin(runPhase) * 3, -s * 0.3);
  ctx.stroke();

  ctx.restore();
}

function makeBirds(
  count: number,
  width: number,
  height: number,
): {
  x: number;
  y: number;
  speed: number;
  wingPhase: number;
  size: number;
  seed: number;
}[] {
  const out: {
    x: number;
    y: number;
    speed: number;
    wingPhase: number;
    size: number;
    seed: number;
  }[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      x: Math.random() * width,
      y: height * (0.15 + Math.random() * 0.6),
      speed: 25 + Math.random() * 35,
      wingPhase: Math.random() * Math.PI * 2,
      size: 0.9 + Math.random() * 0.5,
      seed: i * 7,
    });
  }
  return out;
}

function drawBird(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  wingPhase: number,
  size: number,
  goingRight: boolean,
) {
  const flap = Math.sin(wingPhase) * 0.4;
  const scale = 14 * size;
  const dir = goingRight ? 1 : -1;
  ctx.strokeStyle = BIRD_COLOR;
  ctx.lineWidth = 1.5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x - dir * scale, y);
  ctx.quadraticCurveTo(
    x - dir * scale * 0.3,
    y - scale * (0.6 + flap),
    x,
    y + scale * 0.2,
  );
  ctx.quadraticCurveTo(
    x + dir * scale * 0.3,
    y - scale * (0.6 - flap),
    x + dir * scale,
    y,
  );
  ctx.stroke();
}

function makeStars(
  count: number,
  width: number,
  height: number,
): { x: number; y: number; r: number; twinkle: number }[] {
  const out: { x: number; y: number; r: number; twinkle: number }[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      x: Math.random() * width,
      y: Math.random() * height * 0.85,
      r: Math.random() * 1.2 + 0.4,
      twinkle: Math.random() * Math.PI * 2,
    });
  }
  return out;
}

function makeClouds(
  width: number,
  height: number,
): {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  speed: number;
  seed: number;
}[][] {
  const layers = [
    { count: 4, yBase: 0.25, size: 80, speed: 28 },
    { count: 5, yBase: 0.45, size: 120, speed: 18 },
    { count: 4, yBase: 0.65, size: 100, speed: 10 },
    { count: 3, yBase: 0.8, size: 140, speed: 6 },
  ];
  return layers.map((layer, li) => {
    const clouds: {
      x: number;
      y: number;
      w: number;
      h: number;
      color: string;
      speed: number;
      seed: number;
    }[] = [];
    for (let i = 0; i < layer.count; i++) {
      const s = li * 100 + i * 17 + width * 0.001;
      clouds.push({
        x: (i / layer.count) * width * 1.5 - width * 0.2,
        y: height * layer.yBase + Math.sin(s * 13) * 30,
        w: layer.size + (Math.sin(s * 7) * 0.5 + 0.5) * 40,
        h: layer.size * 0.4 + (Math.sin(s * 11) * 0.5 + 0.5) * 20,
        color: CLOUD_COLORS[li % CLOUD_COLORS.length],
        speed: layer.speed,
        seed: li * 1000 + i * 123,
      });
    }
    return clouds;
  });
}

interface GameSkyBackgroundProps {
  variant?: "full" | "minimal";
  moon?: boolean;
  birds?: boolean;
  dogs?: boolean;
}

export function GameSkyBackground({
  variant = "full",
  moon = true,
  birds: showBirds = false,
  dogs: showDogs = false,
}: GameSkyBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let lastTime = 0;
    let stars: { x: number; y: number; r: number; twinkle: number }[] = [];
    let cloudLayers: {
      x: number;
      y: number;
      w: number;
      h: number;
      color: string;
      speed: number;
      seed: number;
    }[][] = [];
    let birdList: {
      x: number;
      y: number;
      speed: number;
      wingPhase: number;
      size: number;
      seed: number;
      right: boolean;
    }[] = [];
    let dogList: {
      x: number;
      y: number;
      speed: number;
      runPhase: number;
      size: number;
      seed: number;
      right: boolean;
    }[] = [];

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio, 2);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      stars = makeStars(80, w, h);
      cloudLayers = variant === "full" ? makeClouds(w, h) : [];
      if (showBirds) {
        const raw = makeBirds(15, w, h);
        birdList = raw.map((b) => ({ ...b, right: Math.random() > 0.5 }));
      } else {
        birdList = [];
      }
      if (showDogs) {
        dogList = makeDogs(10, w, h);
      } else {
        dogList = [];
      }
    };

    const seed = (s: number) => {
      const x = Math.sin(s * 12.9898) * 43758.5453;
      return x - Math.floor(x);
    };
    const drawPixelCloud = (
      cx: number,
      cy: number,
      w: number,
      h: number,
      color: string,
      cloudSeed: number,
    ) => {
      const step = 10;
      ctx.fillStyle = color;
      for (let px = 0; px < w; px += step) {
        for (let py = 0; py < h; py += step) {
          if (seed(cloudSeed + px * 0.1 + py) > 0.4) continue;
          const x = cx + px + (seed(cloudSeed + px + 1) - 0.5) * step;
          const y = cy + py + (seed(cloudSeed + py + 2) - 0.5) * step;
          ctx.fillRect(x, y, step, step);
        }
      }
      const blobCount = 5 + Math.floor(w / 50);
      for (let i = 0; i < blobCount; i++) {
        const bx = cx + seed(cloudSeed + i * 7) * w;
        const by = cy + seed(cloudSeed + i * 13) * h;
        const br = 14 + seed(cloudSeed + i * 19) * 18;
        ctx.beginPath();
        ctx.arc(bx, by, br, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const animate = (now: number) => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (!w || !h) {
        raf = requestAnimationFrame(animate);
        return;
      }
      const dt = lastTime ? Math.min((now - lastTime) / 1000, 0.1) : 0.016;
      lastTime = now;

      const time = now * 0.001;

      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, SKY_TOP);
      grad.addColorStop(1, SKY_BOTTOM);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      stars.forEach((s) => {
        const twinkle = Math.sin(time * 2 + s.twinkle) * 0.5 + 0.5;
        ctx.fillStyle = `rgba(232, 230, 227, ${0.4 + twinkle * 0.6})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      });

      if (moon) {
        const moonX = w * 0.78;
        const moonY = h * 0.2;
        const moonR = Math.min(w, h) * 0.12;
        ctx.fillStyle = MOON_GLOW;
        for (let i = 3; i >= 1; i--) {
          ctx.beginPath();
          ctx.arc(moonX, moonY, moonR + i * 18, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = MOON_COLOR;
        ctx.beginPath();
        ctx.arc(moonX, moonY, moonR, 0, Math.PI * 2);
        ctx.fill();
      }

      if (variant === "full") {
        cloudLayers.forEach((layer) => {
          layer.forEach((c) => {
            c.x += c.speed * dt;
            if (c.x > w + c.w) c.x = -c.w - 40;
            drawPixelCloud(c.x, c.y, c.w, c.h, c.color, c.seed);
          });
        });
      }

      if (showBirds && birdList.length > 0) {
        birdList.forEach((b) => {
          b.x += (b.right ? 1 : -1) * b.speed * dt;
          b.wingPhase += dt * 6;
          if (b.right && b.x > w + 30) b.x = -30;
          if (!b.right && b.x < -30) b.x = w + 30;
          drawBird(ctx, b.x, b.y, b.wingPhase, b.size, b.right);
        });
      }

      if (showDogs && dogList.length > 0) {
        dogList.forEach((d) => {
          d.x += (d.right ? 1 : -1) * d.speed * dt;
          d.runPhase += dt * 10;
          if (d.right && d.x > w + 50) d.x = -50;
          if (!d.right && d.x < -50) d.x = w + 50;
          drawDog(ctx, d.x, d.y, d.runPhase, d.size, d.right);
        });
      }

      raf = requestAnimationFrame(animate);
    };

    resize();
    window.addEventListener("resize", resize);
    raf = requestAnimationFrame(animate);

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(raf);
    };
  }, [variant, moon, showBirds, showDogs]);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 h-full w-full object-cover"
      style={{ display: "block" }}
      aria-hidden
    />
  );
}
