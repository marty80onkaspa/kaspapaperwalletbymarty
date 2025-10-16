import React, { useEffect, useRef, useState, useMemo } from "react";
import QRCode from "qrcode";
import "./App.css";
import kaspaLogo from "./assets/kaspa-logo.webp";
import martyMark from "./assets/marty.webp";
import kaspaLogo2 from "./assets/kaspa-logo2.webp"; // mini-logo for the panels
import donateImg from "./assets/donate.webp";
import websiteIcon from "./assets/website.webp";

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

/** stringify mnemonic robustly */
function printableOf(mnemonic) {
  try {
    const s = mnemonic.toString();
    const maybe = JSON.parse(s);
    return maybe?.phrase || s;
  } catch {
    return mnemonic.toString();
  }
}

export default function App() {
  const [kaspa, setKaspa] = useState(null);
  const [busy, setBusy] = useState(false);
  const [words, setWords] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [privHex, setPrivHex] = useState("");
  const [address, setAddress] = useState("");

  // === BRANDING (STEP 1) ===
  const [walletName, setWalletName] = useState(""); // placeholder only
  const [tickerInput, setTickerInput] = useState("MARTY");
  const previewUrl = useMemo(() => {
    const t = (tickerInput || "").trim().toUpperCase();
    return t ? `https://krc20-assets.kas.fyi/icons/${t}.jpg` : "";
  }, [tickerInput]);
  const [previewOk, setPreviewOk] = useState(true);
  const [tokenImageUrl, setTokenImageUrl] = useState(null); // applied on STEP 3

  // Seed length (12 or 24)
  const [wordCount, setWordCount] = useState(24);

  // 🎨 Card background color (Step 3)
  const [cardBg, setCardBg] = useState("#ffffff");

  // Auto-composed name: (TICKER)'S WALLET (or WALLET if empty)
  const composedWallet = useMemo(() => {
    const t = (tickerInput || "").trim().toUpperCase();
    return t ? `${t}'S WALLET` : "WALLET";
  }, [tickerInput]);

  // QR canvases
  const pubBackQRRef = useRef(null);
  const secQRRef = useRef(null);

  // --------- Entropy (inline in STEP 2) ----------
  const [collecting, setCollecting] = useState(false);
  const [progress, setProgress] = useState(0); // 0..100
  const poolRef = useRef(new Uint8Array(4096));
  const offsetRef = useRef(0);
  const ticksRef = useRef(0);
  const TARGET_TICKS = 1280;

  // ====== TRAIL (yellow strokes ~2s) ======
  const trailCanvasRef = useRef(null);
  const trailRAF = useRef(null);
  const lastTrailPtRef = useRef(null);
  const trailSegRef = useRef([]); // {x0,y0,x1,y1,t}

  const TRAIL_MAX_AGE = 2000; // ms
  const TRAIL_RGB = [255, 208, 0];
  const TRAIL_WIDTH = 2.2;

  function resetEntropy() {
    poolRef.current.fill(0);
    offsetRef.current = 0;
    ticksRef.current = 0;
    setProgress(0);
    // reset trail
    trailSegRef.current = [];
    lastTrailPtRef.current = null;
    const cvs = trailCanvasRef.current;
    if (cvs) {
      const ctx = cvs.getContext("2d");
      ctx.clearRect(0, 0, cvs.width, cvs.height);
    }
  }

  function addEntropySample(ev) {
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
    setProgress(Math.min(100, (ticks / TARGET_TICKS) * 100));
  }

  function addTrailPoint(clientX, clientY) {
    const last = lastTrailPtRef.current;
    const now = performance.now();
    if (last) {
      trailSegRef.current.push({
        x0: last.x,
        y0: last.y,
        x1: clientX,
        y1: clientY,
        t: now,
      });
    }
    lastTrailPtRef.current = { x: clientX, y: clientY };
  }

  function startTrail() {
    const cvs = trailCanvasRef.current;
    if (!cvs) return;
    const ctx = cvs.getContext("2d");
    const fit = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = window.innerWidth;
      const h = window.innerHeight;
      cvs.style.width = w + "px";
      cvs.style.height = h + "px";
      cvs.width = Math.floor(w * dpr);
      cvs.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    fit();
    const onResize = () => fit();
    window.addEventListener("resize", onResize);

    const draw = () => {
      ctx.clearRect(0, 0, cvs.width, cvs.height);
      const now = performance.now();
      const segs = trailSegRef.current;
      let i = 0;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (const seg of segs) {
        const age = now - seg.t;
        if (age < TRAIL_MAX_AGE) {
          const alpha = 1 - age / TRAIL_MAX_AGE;
          ctx.strokeStyle = `rgba(${TRAIL_RGB[0]}, ${TRAIL_RGB[1]}, ${TRAIL_RGB[2]}, ${alpha})`;
          ctx.lineWidth = TRAIL_WIDTH;
          ctx.beginPath();
          ctx.moveTo(seg.x0, seg.y0);
          ctx.lineTo(seg.x1, seg.y1);
          ctx.stroke();
          segs[i++] = seg;
        }
      }
      segs.length = i;
      trailRAF.current = requestAnimationFrame(draw);
    };

    trailRAF.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(trailRAF.current);
      window.removeEventListener("resize", onResize);
      ctx.clearRect(0, 0, cvs.width, cvs.height);
    };
  }

  async function finalizeFromMnemonic(mnemonic) {
    const seed = mnemonic.toSeed(passphrase || "");
    const xprv = new kaspa.XPrv(seed);
    const gen = new kaspa.PrivateKeyGenerator(xprv, false, 0n);
    const key = gen.receiveKey(0);
    const net = kaspa.NetworkType.MAINNET;
    const addr = key.toAddress(net).toString();

    const printable = printableOf(mnemonic);
    setWords(printable);
    setPrivHex(key.toString());
    setAddress(addr);

    await drawQR(pubBackQRRef.current, addr, 520);
    await drawQR(secQRRef.current, printable, 520);
  }

  async function finishCollect() {
    try {
      setBusy(true);
      // Raw 32-byte entropy -> adapt to 12 (128-bit) or 24 (256-bit)
      const digest = await sha256(poolRef.current);
      let entropyBytes = digest;
      if (wordCount === 12) entropyBytes = digest.slice(0, 16);

      const maybe = await mnemonicFromEntropy(kaspa, entropyBytes);
      const mnemonic = maybe || kaspa.Mnemonic.random(wordCount);
      await finalizeFromMnemonic(mnemonic);
    } catch (e) {
      console.error(e);
      alert("Error during generation (see console).");
    } finally {
      setBusy(false);
      setCollecting(false);
    }
  }

  async function skipEntropyAndGenerate() {
    if (!kaspa) return;
    try {
      setBusy(true);
      const mnemonic = kaspa.Mnemonic.random(wordCount);
      await finalizeFromMnemonic(mnemonic);
    } catch (e) {
      console.error(e);
      alert("Error during generation (see console).");
    } finally {
      setBusy(false);
      setCollecting(false);
    }
  }

  function onGenerateClick() {
    if (!kaspa || busy) return;
    resetEntropy();
    setCollecting(true);
  }

  // Auto-generation on 12/24 toggle is intentionally disabled.

  // Attach entropy listeners while collecting + yellow cursor + trail
  useEffect(() => {
    if (!collecting) return;

    const svg =
      `<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16'>` +
      `<circle cx='4' cy='4' r='3' fill='#ffd000' stroke='#222' stroke-width='1'/>` +
      `</svg>`;
    const url = `url("data:image/svg+xml,${encodeURIComponent(
      svg
    )}") 4 4, crosshair`;
    const prevCursor = document.body.style.cursor;
    document.body.style.cursor = url;

    const stopTrail = startTrail();

    const onMove = (e) => {
      const x = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
      const y = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
      addEntropySample(e);
      addTrailPoint(x, y);
    };
    const onTouch = (e) => {
      const t = e.touches?.[0];
      if (t) {
        addEntropySample({
          clientX: t.clientX,
          clientY: t.clientY,
          movementX: 1,
          movementY: 1,
        });
        addTrailPoint(t.clientX, t.clientY);
      }
    };

    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("touchmove", onTouch, { passive: true });

    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("touchmove", onTouch);
      document.body.style.cursor = prevCursor || "";
      if (stopTrail) stopTrail();
      trailSegRef.current = [];
      lastTrailPtRef.current = null;
    };
  }, [collecting]);

  // Auto-finish when 100%
  useEffect(() => {
    if (collecting && ticksRef.current >= TARGET_TICKS) {
      finishCollect();
    }
  }, [progress, collecting]); // eslint-disable-line

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

  const fillWidth = Math.min(100, Math.max(0.5, progress)); // in %, float

  // Common style for the mini-logo on each PANEL (half)
  const paneBadgeStyle = {
    position: "absolute",
    left: "50%",
    bottom: "2.8mm",
    transform: "translateX(-50%)",
    width: "12mm",
    height: "auto",
    pointerEvents: "none",
    filter: "drop-shadow(0 0.4mm 0.8mm rgba(0,0,0,.18))",
    opacity: 0.95,
  };

  return (
    <div className="app">
      {/* === INLINE MASTHEAD (former SiteHeader) ========================== */}
      <div className="masthead noprint">
        <div className="masthead__inner">
          <div className="masthead__left">
            <img src={kaspaLogo} alt="Kaspa logo" className="site-logo" />
          </div>

          <div className="masthead__center">
            <div className="title-line">
              <h1 className="site-title">Kaspa Paper Wallet Generator</h1>
              <div className="site-byline">
                <span>
                  by <strong>MARTY80</strong>
                </span>
                <img
                  src={martyMark}
                  alt="MARTY80"
                  className="by-icon"
                  loading="eager"
                  decoding="async"
                />
              </div>
            </div>
          </div>

          <nav className="masthead__right" aria-label="Social links">
            <a
              className="social-btn"
              href="https://github.com/marty80onkaspa"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="GitHub"
              title="GitHub"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 .5a12 12 0 0 0-3.79 23.4c.6.11.82-.25.82-.57v-2c-3.34.73-4.04-1.61-4.04-1.61-.55-1.41-1.35-1.79-1.35-1.79-1.1-.74.08-.73.08-.73 1.22.09 1.86 1.26 1.86 1.26 1.08 1.85 2.83 1.32 3.52 1.01.11-.8.42-1.32.77-1.62-2.67-.3-5.48-1.34-5.48-5.94 0-1.31.47-2.38 1.25-3.22-.13-.31-.54-1.56.12-3.25 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.28-1.55 3.29-1.23 3.29-1.23.67 1.69.26 2.94.13 3.25.78.84 1.24 1.91 1.24 3.22 0 4.61-2.81 5.64-5.49 5.93.43.37.82 1.11.82 2.25v3.34c0 .32.21.69.83.57A12 12 0 0 0 12 .5z" />
              </svg>
            </a>

            <a
              className="social-btn"
              href="https://x.com/Marty80onKaspa"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="X (Twitter)"
              title="X (Twitter)"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M18.9 2H22l-7.03 8.03L23.5 22h-6.9l-5.4-7.06L4.9 22H2l7.5-8.57L.5 2h6.9l4.88 6.38L18.9 2Zm-2.42 18h2.29L7.64 4h-2.3l11.14 16Z" />
              </svg>
            </a>
            <a
              className="social-btn"
              href="https://marty80.com"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Website"
              title="Website"
            >
              <img src={websiteIcon} alt="Website" />
            </a>
          </nav>
        </div>
      </div>

      {/* === 3-COLUMN LAYOUT ============================================== */}
      <div className="layout3">
        {/* STEP 1 — BRANDING (vertical rail 90°) */}
        <aside className="col col-left noprint">
          <section className="step-card step1">
            <div className="step-head">
              <span className="step-kicker">STEP 1</span>
              <h2 className="step-title">Branding</h2>
            </div>
            <div className="step-body">
              {/* Token image preview (by ticker) */}
              <div className="brand-logo" style={{ marginBottom: 12 }}>
                <div
                  className="logo-ph"
                  style={{
                    position: "relative",
                    display: "grid",
                    placeItems: "center",
                    overflow: "visible",
                  }}
                >
                  {previewUrl ? (
                    <img
                      src={previewUrl}
                      alt="Token preview"
                      style={{
                        display: "block",
                        height: "auto",
                        maxHeight: "2000px",
                        maxWidth: "96%",
                        objectFit: "contain",
                        margin: "0 auto",
                      }}
                      onLoad={() => setPreviewOk(true)}
                      onError={() => setPreviewOk(false)}
                    />
                  ) : (
                    "Logo"
                  )}

                  {!previewOk && (
                    <div
                      style={{
                        minHeight: "120px",
                        width: "100%",
                        display: "grid",
                        placeItems: "center",
                        color: "#b00020",
                        fontWeight: 700,
                        background: "rgba(255,255,255,0.6)",
                        borderRadius: 12,
                      }}
                    >
                      Not found
                    </div>
                  )}
                </div>
              </div>

              {/* Wallet name (editable) */}
              <label className="brand-label">Choose Wallet name</label>
              <input
                type="text"
                placeholder="e.g., kaspa"
                className="brand-input"
                value={walletName}
                onChange={(e) => setWalletName(e.target.value)}
              />

              {/* Ticker + apply button */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  gap: 8,
                  marginTop: 10,
                }}
              >
                <div>
                  <label className="brand-label">
                    Choose Token ticker (KRC-20)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g., MARTY"
                    value={tickerInput}
                    onChange={(e) =>
                      setTickerInput(e.target.value.toUpperCase())
                    }
                    spellCheck={false}
                  />
                </div>
                <div style={{ display: "flex", alignItems: "end" }}>
                  <button
                    className="ghost"
                    disabled={!previewUrl || !previewOk}
                    onClick={() => setTokenImageUrl(previewUrl)}
                    title="Use this logo on the card"
                  >
                    Use on card
                  </button>
                </div>
              </div>

              {/* 12 / 24 words + 🎨 color picker on the same row */}
              <div style={{ marginTop: 14 }}>
                <label className="brand-label">Seed length</label>
                <div
                  style={{
                    display: "flex",
                    gap: 12,
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  <label
                    style={{
                      display: "inline-flex",
                      gap: 6,
                      alignItems: "center",
                    }}
                  >
                    <input
                      type="radio"
                      name="seedlen"
                      value="12"
                      checked={wordCount === 12}
                      onChange={() => setWordCount(12)}
                    />
                    12 words
                  </label>
                  <label
                    style={{
                      display: "inline-flex",
                      gap: 6,
                      alignItems: "center",
                    }}
                  >
                    <input
                      type="radio"
                      name="seedlen"
                      value="24"
                      checked={wordCount === 24}
                      onChange={() => setWordCount(24)}
                    />
                    24 words
                  </label>

                  {/* Color selector on the same line */}
                  <div
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      marginLeft: "auto",
                    }}
                  >
                    <span className="brand-label" style={{ margin: 0 }}>
                      Background
                    </span>
                    <input
                      type="color"
                      value={cardBg}
                      onChange={(e) => setCardBg(e.target.value)}
                      aria-label="Choose card background color"
                      style={{
                        width: 44,
                        height: 32,
                        padding: 0,
                        border: "none",
                        background: "transparent",
                        cursor: "pointer",
                        appearance: "auto",
                      }}
                    />
                  </div>
                </div>
              </div>

              <p className="muted" style={{ marginTop: 8 }}>
                The URL is hidden. Only the ticker is needed.
              </p>
            </div>
          </section>
        </aside>

        {/* STEP 2 — GENERATION (vertical rail 90°, inline entropy) */}
        <main className="col col-center noprint">
          <section className="step-card step2">
            <div className="step-head">
              <span className="step-kicker">STEP 2</span>
              <h2 className="step-title">Generation</h2>
            </div>

            <div className="step-body">
              <p className="muted">
                Before generating the address you can cut your internet
                connection if you want
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
                  <button
                    disabled={!ready || busy || collecting}
                    onClick={onGenerateClick}
                  >
                    Generate Card
                  </button>
                  <button
                    className="ghost"
                    disabled={!ready || busy}
                    onClick={skipEntropyAndGenerate}
                    title="Generate without entropy collection"
                  >
                    Skip entropy
                  </button>
                </div>
              </div>

              {(collecting || ticksRef.current > 0) && (
                <>
                  <div className="pm-prog" style={{ marginTop: 12 }}>
                    <div className="pm-prog__track">
                      <div
                        className="pm-prog__fill"
                        style={{ width: `${fillWidth}%` }}
                      />
                    </div>
                  </div>
                  <div className="progress-meta">
                    <span>
                      {ticksRef.current} / {TARGET_TICKS} samples
                    </span>
                    <span>{Math.floor(progress)}%</span>
                  </div>
                </>
              )}
              {address && (
                <div
                  className="donate-block"
                  style={{
                    marginTop: 100, // was 16 — add more air before the title
                    textAlign: "center",
                  }}
                >
                  <div
                    className="muted donate-title"
                    style={{
                      fontWeight: 900,
                      textTransform: "uppercase",
                      letterSpacing: ".06em",
                      marginBottom: 20, // a bit more air under the title
                      fontSize: "25px", // enlarge "Donate"
                      lineHeight: 1.2,
                    }}
                  >
                    Donate
                  </div>

                  <img
                    src={donateImg}
                    alt="Donate in Kaspa"
                    style={{
                      display: "block",
                      margin: "0 auto 8px",
                      maxWidth: 200,
                      width: "100%",
                      height: "auto",
                      borderRadius: 12,
                      boxShadow: "0 6px 18px rgba(0,0,0,.12)",
                    }}
                    loading="lazy"
                    decoding="async"
                  />

                  <code
                    className="mono no-scroll"
                    style={{
                      display: "inline-block",
                      padding: "8px 12px",
                      borderRadius: 8,
                      background: "rgba(0,0,0,.06)",
                      userSelect: "all",
                      fontSize: "15px",
                      lineHeight: 1.25,
                      letterSpacing: "0.2px",
                      wordBreak: "break-all",
                    }}
                  >
                    kaspa:qrdc534sgr3ng96dmkcxnsz5c827g2s7mecpqvmlrkfuunnsu9tnjkv5q8emd
                  </code>
                </div>
              )}
            </div>
          </section>
        </main>

        {/* STEP 3 — PREVIEW + PRINT (vertical rail + side print button) */}
        <section className="col col-right">
          <section className="step-card step3">
            {/* Left vertical rail: rotated title */}
            <div className="step-head">
              <span className="step-kicker">STEP 3</span>
              <h2 className="step-title">Final preview</h2>
            </div>

            {/* Body: the two cards */}
            <div className="step-body">
              <div className={`preview-panel ${address ? "" : "is-empty"}`}>
                <div className="preview-stage">
                  {/* ================= PAGE 1 — OUTSIDE ================= */}
                  <div className="preview-sheet">
                    <div
                      className="sheet card-sheet outside"
                      style={{ backgroundColor: cardBg }}
                    >
                      <div
                        className="half back"
                        style={{ position: "relative" }}
                      >
                        <div className="pad pad-back">
                          <canvas ref={pubBackQRRef} className="qr-public" />
                          <div className="addrBlock addr-back">
                            <code className="addr">{address || "…"}</code>
                          </div>
                        </div>
                        {/* mini-logo on the BACK panel */}
                        <img
                          src={kaspaLogo2}
                          alt="Kaspa"
                          style={paneBadgeStyle}
                          crossOrigin="anonymous"
                        />
                      </div>

                      <div
                        className="half cover"
                        style={{ position: "relative" }}
                      >
                        <div
                          className="pad pad-cover"
                          style={{ gap: "2.5mm", alignItems: "center" }}
                        >
                          {/* Wallet name line (above) */}
                          {walletName.trim() && (
                            <div
                              className="cover-owner"
                              style={{
                                textAlign: "center",
                                fontSize: "6.2mm",
                                letterSpacing: "0.22mm",
                                fontWeight: 900,
                                textTransform: "uppercase",
                                lineHeight: 1.02,
                                color: "#111",
                              }}
                            >
                              {walletName}
                            </div>
                          )}

                          {/* Composed name (TICKER'S WALLET) */}
                          <div
                            className="cover-name"
                            style={{
                              textAlign: "center",
                              fontSize: "9mm",
                              letterSpacing: "0.25mm",
                              fontWeight: 900,
                              textTransform: "uppercase",
                              lineHeight: 1.02,
                            }}
                          >
                            {composedWallet}
                          </div>

                          {/* Token image (if applied) */}
                          {tokenImageUrl && (
                            <div
                              className="token-slot"
                              style={{
                                width: "36mm",
                                height: "36mm",
                                border: "1px solid #ddd",
                                borderRadius: "2mm",
                                background: "#fff",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                overflow: "hidden",
                              }}
                            >
                              <img
                                src={tokenImageUrl}
                                alt="Token"
                                style={{
                                  maxWidth: "100%",
                                  maxHeight: "100%",
                                  display: "block",
                                }}
                                crossOrigin="anonymous"
                              />
                            </div>
                          )}
                        </div>
                        {/* mini-logo on the COVER panel */}
                        <img
                          src={kaspaLogo2}
                          alt="Kaspa"
                          style={paneBadgeStyle}
                          crossOrigin="anonymous"
                        />
                      </div>

                      <div className="fold-line" aria-hidden="true" />
                    </div>
                  </div>

                  {/* ================= PAGE 2 — INSIDE ================= */}
                  <div className="preview-sheet">
                    <div
                      className="sheet card-sheet inside"
                      style={{ backgroundColor: cardBg }}
                    >
                      <div
                        className="half secret-left"
                        style={{ position: "relative" }}
                      >
                        <div className="pad pad-secret">
                          <div className="label danger">
                            SECRET — DO NOT SHARE
                          </div>
                          <div className="info">
                            <label className="label">
                              Seed ({wordCount} words)
                            </label>
                            <code className="mono no-scroll">
                              {words || "…"}
                            </code>
                          </div>
                          <div className="info">
                            <label className="label">Passphrase</label>
                            <code className="mono no-scroll">
                              {passphrase || "(none)"}{" "}
                            </code>
                          </div>
                          <div className="info">
                            <label className="label">Private Key (hex)</label>
                            <code className="mono no-scroll">
                              {privHex || "…"}
                            </code>
                          </div>
                        </div>
                        {/* mini-logo on the SECRET-LEFT panel */}
                        <img
                          src={kaspaLogo2}
                          alt="Kaspa"
                          style={paneBadgeStyle}
                          crossOrigin="anonymous"
                        />
                      </div>

                      <div
                        className="half secret-right"
                        style={{ position: "relative" }}
                      >
                        <div className="pad">
                          <div className="label">
                            QR — Seed ({wordCount} words)
                          </div>
                          <canvas ref={secQRRef} className="qr-seed" />
                        </div>
                        {/* mini-logo on the SECRET-RIGHT panel */}
                        <img
                          src={kaspaLogo2}
                          alt="Kaspa"
                          style={paneBadgeStyle}
                          crossOrigin="anonymous"
                        />
                      </div>

                      <div className="fold-line" aria-hidden="true" />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Right rail: print button next to the cards */}
            <div className="step-side-print">
              <button
                className="ghost"
                onClick={() => window.print()}
                disabled={!address}
                title={address ? "Print" : "Generate the card first"}
              >
                Print
              </button>
            </div>
          </section>
        </section>
      </div>

      {/* Yellow trail canvas (only visible during entropy collection) */}
      <canvas
        ref={trailCanvasRef}
        className="noprint"
        style={{
          position: "fixed",
          inset: 0,
          pointerEvents: "none",
          zIndex: 5,
          display: collecting ? "block" : "none",
        }}
      />
    </div>
  );
}
