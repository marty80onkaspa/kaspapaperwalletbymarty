// src/App.jsx
// UI + wallet generation. Header is independent from card logic.

import React, { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import "./App.css";
import SiteHeader from "./components/SiteHeader"; // header component

/** Draw a QR (fixed bitmap, clear before rendering) */
async function drawQR(canvas, text, px = 520) {
  if (!canvas || !text) return;
  if (canvas.width !== px) canvas.width = px;
  if (canvas.height !== px) canvas.height = px;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  await QRCode.toCanvas(canvas, String(text).trim(), {
    width: px,
    margin: 1,
    errorCorrectionLevel: "M",
    color: { dark: "#000000", light: "#ffffff" },
  });
}

/** Load Kaspa SDK (web build) */
async function loadKaspa() {
  const candidates = [
    { js: "/wasm/web/kaspa/kaspa.js", wasm: "/wasm/web/kaspa/kaspa_bg.wasm" },
    { js: "/wasm/kaspa/kaspa.js", wasm: "/wasm/kaspa/kaspa_bg.wasm" },
  ];
  let lastErr = null;
  for (const c of candidates) {
    try {
      const jsUrl = new URL(c.js, window.location.origin).href;
      const mod = await import(/* @vite-ignore */ jsUrl);
      if (typeof mod.default === "function") await mod.default(c.wasm);
      else if (typeof mod.init === "function") await mod.init(c.wasm);
      else if (typeof mod.initSync === "function") {
        const bytes = await fetch(c.wasm).then((r) => r.arrayBuffer());
        mod.initSync(bytes);
      } else throw new Error("No init function");
      const required = [
        "Mnemonic",
        "XPrv",
        "PrivateKeyGenerator",
        "NetworkType",
      ];
      for (const k of required)
        if (!(k in mod)) throw new Error(`Missing export: ${k}`);
      return mod;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("Unable to load Kaspa SDK.");
}

/** Mnemonic from raw entropy (if available), otherwise null */
async function mnemonicFromEntropy(kaspa, entropyBytes) {
  if (kaspa?.Mnemonic?.fromEntropy)
    return kaspa.Mnemonic.fromEntropy(entropyBytes);
  if (kaspa?.Mnemonic?.entropyToMnemonic)
    return kaspa.Mnemonic.entropyToMnemonic(entropyBytes);
  const hex = Array.from(entropyBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  if (kaspa?.Mnemonic?.fromEntropyHex)
    return kaspa.Mnemonic.fromEntropyHex(hex);
  return null;
}

/** SHA-256 → Uint8Array(32) */
async function sha256(bytes) {
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return new Uint8Array(buf);
}

export default function App() {
  const [kaspa, setKaspa] = useState(null);
  const [busy, setBusy] = useState(false);
  const [words, setWords] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [privHex, setPrivHex] = useState("");
  const [address, setAddress] = useState("");

  // QR canvases
  const pubBackQRRef = useRef(null);
  const secQRRef = useRef(null);

  // --------- Entropy ----------
  const [collecting, setCollecting] = useState(false);
  const [progress, setProgress] = useState(0); // floating percentage 0..100
  const poolRef = useRef(new Uint8Array(4096));
  const offsetRef = useRef(0);
  const ticksRef = useRef(0);
  const TARGET_TICKS = 1280;

  // Trace
  const padRef = useRef(null);
  const traceRef = useRef(null);
  const lastPtRef = useRef(null);

  function resizeTraceCanvas() {
    const pad = padRef.current,
      cvs = traceRef.current;
    if (!pad || !cvs) return;
    const rect = pad.getBoundingClientRect();
    cvs.width = Math.max(10, Math.floor(rect.width));
    cvs.height = Math.max(10, Math.floor(rect.height));
    const ctx = cvs.getContext("2d");
    ctx.clearRect(0, 0, cvs.width, cvs.height);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "#39d0ff";
  }

  useEffect(() => {
    if (!collecting) return;
    resizeTraceCanvas();
    const onResize = () => resizeTraceCanvas();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [collecting]);

  function resetEntropy() {
    poolRef.current.fill(0);
    offsetRef.current = 0;
    ticksRef.current = 0;
    setProgress(0);
    lastPtRef.current = null;
    requestAnimationFrame(() => resizeTraceCanvas());
  }

  function addEntropySample(ev) {
    // 1) pool
    const r = new Uint32Array(1);
    crypto.getRandomValues(r);
    const t = Math.floor(performance.now() * 1000);
    const x = (ev.clientX ?? 0) & 0xffff;
    const y = (ev.clientY ?? 0) & 0xffff;
    const mx = (ev.movementX ?? 0) & 0xffff;
    const my = (ev.movementY ?? 0) & 0xffff;
    const buf = new ArrayBuffer(16);
    const dv = new DataView(buf);
    dv.setUint16(0, x, true);
    dv.setUint16(2, y, true);
    dv.setUint16(4, mx, true);
    dv.setUint16(6, my, true);
    dv.setUint32(8, t >>> 0, true);
    dv.setUint32(12, r[0] >>> 0, true);
    const bytes = new Uint8Array(buf);

    const pool = poolRef.current;
    let off = offsetRef.current;
    for (let i = 0; i < bytes.length; i++)
      pool[(off + i) % pool.length] ^= bytes[i];
    off = (off + bytes.length) % pool.length;
    offsetRef.current = off;

    const ticks = Math.min(TARGET_TICKS, ticksRef.current + 1);
    ticksRef.current = ticks;

    // exact percentage (float), 100% only at 1280/1280
    const pct = Math.min(100, (ticks / TARGET_TICKS) * 100);
    setProgress(pct);

    // 2) trace
    const pad = padRef.current,
      cvs = traceRef.current;
    if (!pad || !cvs) return;
    const rect = pad.getBoundingClientRect();
    const cx = ev.clientX - rect.left,
      cy = ev.clientY - rect.top;
    const ctx = cvs.getContext("2d");
    const last = lastPtRef.current;
    if (last) {
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(cx, cy);
      ctx.stroke();
    }
    lastPtRef.current = { x: cx, y: cy };
  }

  function startCollect() {
    setCollecting(true);
    setTimeout(() => {
      resetEntropy();
      resizeTraceCanvas();
    }, 0);
  }

  async function finishCollect() {
    const entropy = await sha256(poolRef.current);
    setCollecting(false);
    await generateWithEntropy(entropy);
  }

  // ------------------------------------------

  useEffect(() => {
    (async () => {
      try {
        setKaspa(await loadKaspa());
      } catch (e) {
        console.error("[Kaspa init error]", e);
        alert("Kaspa loading failed. Details in console.");
      }
    })();
  }, []);

  const ready = !!kaspa;

  useEffect(() => {
    if (address) drawQR(pubBackQRRef.current, address, 520);
  }, [address]);
  useEffect(() => {
    if (words) drawQR(secQRRef.current, words, 520);
  }, [words]);

  async function generateWithEntropy(entropyBytes) {
    if (!ready) return;
    setBusy(true);
    try {
      let mnemonic = await mnemonicFromEntropy(kaspa, entropyBytes);
      if (!mnemonic) mnemonic = kaspa.Mnemonic.random(24);

      let printable = "";
      try {
        const s = mnemonic.toString();
        const maybe = JSON.parse(s);
        printable = maybe?.phrase || s;
      } catch {
        printable = mnemonic.toString();
      }

      const seed = mnemonic.toSeed(passphrase || "");
      const xprv = new kaspa.XPrv(seed);
      const gen = new kaspa.PrivateKeyGenerator(xprv, false, 0n);
      const key = gen.receiveKey(0);
      const net = kaspa.NetworkType.MAINNET;
      const addr = key.toAddress(net).toString();

      setWords(printable);
      setPrivHex(key.toString());
      setAddress(addr);

      await drawQR(pubBackQRRef.current, addr, 520);
      await drawQR(secQRRef.current, printable, 520);
    } catch (e) {
      console.error(e);
      alert("Error during generation (see console).");
    } finally {
      setBusy(false);
    }
  }

  function onGenerateClick() {
    if (!ready) return;
    startCollect();
  }

  const fillWidth = Math.min(100, Math.max(0.5, progress)); // in %, float

  return (
    <div className="app">
      <SiteHeader />

      <div className="card noprint" style={{ marginBottom: 16 }}>
        <h1>PaperMarty — Kaspa Paper Wallet (Folded Card)</h1>
        <p className="muted">
          Generates the card (ID-1 format). Page 1 = Outside • Page 2 = Inside.
          For printing: A4, duplex, flip on short edge.
        </p>
        <div className="row" style={{ marginTop: 12 }}>
          <div>
            <label>BIP-39 Passphrase (optional)</label>
            <input
              type="text"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="(empty recommended)"
            />
          </div>
          <div style={{ display: "flex", alignItems: "end", gap: 8 }}>
            <button disabled={!ready || busy} onClick={onGenerateClick}>
              Generate Card
            </button>
            <button
              className="ghost"
              onClick={() => window.print()}
              disabled={!address}
            >
              Print
            </button>
          </div>
        </div>
      </div>

      {/* Entropy collection Overlay */}
      {collecting && (
        <div className="entropy-overlay">
          <div className="entropy-card">
            <h2>Strengthen Randomness 🌀</h2>
            <p className="muted">
              Move the mouse <strong>for a long time</strong> and{" "}
              <em>unpredictably</em> within the large square. The bar must reach{" "}
              <strong>100%</strong>.
            </p>

            <div
              className="entropy-pad"
              ref={padRef}
              onMouseMove={addEntropySample}
              onTouchMove={(e) => {
                const t = e.touches[0];
                if (t)
                  addEntropySample({
                    clientX: t.clientX,
                    clientY: t.clientY,
                    movementX: 1,
                    movementY: 1,
                  });
              }}
            >
              <canvas ref={traceRef} className="entropy-canvas" />
              <div className="entropy-instr">move your mouse here</div>
            </div>

            {/* Progress bar */}
            <div className="pm-prog">
              <div className="pm-prog__track">
                <div
                  className="pm-prog__fill"
                  style={{ width: `${fillWidth}%` }}
                />
              </div>
            </div>

            <div className="progress-meta">
              <span>
                {ticksRef.current} / {1280} samples
              </span>
              <span>{Math.floor(progress)}%</span>
            </div>

            <div className="entropy-actions">
              <button
                disabled={ticksRef.current < 1280}
                onClick={finishCollect}
              >
                Finish (100%)
              </button>
              <button className="ghost" onClick={() => setCollecting(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {address && (
        <>
          {/* ================= PAGE 1 — OUTSIDE ================= */}
          <div className="sheet card-sheet outside">
            <div className="half back">
              <div className="pad pad-back">
                <canvas ref={pubBackQRRef} className="qr-public" />
                <div className="addrBlock addr-back">
                  <code className="addr">{address}</code>
                </div>
              </div>
            </div>
            <div className="half cover">
              <div className="pad pad-cover">
                <div className="logo">
                  PAPER<span>MARTY</span>
                </div>
              </div>
            </div>
            <div className="fold-line" aria-hidden="true" />
          </div>

          {/* ================= PAGE 2 — INSIDE ================= */}
          <div className="sheet card-sheet inside">
            <div className="half secret-left">
              <div className="pad pad-secret">
                <div className="label danger">SECRET — DO NOT SHARE</div>
                <div className="info">
                  <label className="label">Seed (24 words)</label>
                  <code className="mono no-scroll">{words}</code>
                </div>
                <div className="info">
                  <label className="label">Passphrase</label>
                  <code className="mono no-scroll">
                    {passphrase || "(none)"}{" "}
                  </code>
                </div>
                <div className="info">
                  <label className="label">Private Key (hex)</label>
                  <code className="mono no-scroll">{privHex}</code>
                </div>
              </div>
            </div>
            <div className="half secret-right">
              <div className="pad">
                <div className="label">QR — Seed (24 words)</div>
                <canvas ref={secQRRef} className="qr-seed" />
              </div>
            </div>
            <div className="fold-line" aria-hidden="true" />
          </div>
        </>
      )}
    </div>
  );
}
