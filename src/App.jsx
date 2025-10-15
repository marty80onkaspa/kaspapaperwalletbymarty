// src/App.jsx
// UI + wallet generation. Header is now inlined at the top of the page.

import React, { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import "./App.css";
import kaspaLogo from "./assets/kaspa-logo.webp";
import martyMark from "./assets/marty.webp";

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

  // === Entropy helpers (no canvas trace, just sampling) ===
  function resetEntropy() {
    poolRef.current.fill(0);
    offsetRef.current = 0;
    ticksRef.current = 0;
    setProgress(0);
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

  async function finishCollect() {
    try {
      setBusy(true);
      const entropy = await sha256(poolRef.current);
      const maybe = await mnemonicFromEntropy(kaspa, entropy);
      const mnemonic = maybe || kaspa.Mnemonic.random(24);
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
      const mnemonic = kaspa.Mnemonic.random(24);
      await finalizeFromMnemonic(mnemonic);
    } catch (e) {
      console.error(e);
      alert("Error during generation (see console).");
    } finally {
      setBusy(false);
      setCollecting(false);
    }
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

  function onGenerateClick() {
    if (!kaspa || busy) return;
    resetEntropy();
    setCollecting(true);
  }

  // Attach entropy listeners while collecting
  useEffect(() => {
    if (!collecting) return;
    const onMouse = (e) => addEntropySample(e);
    const onTouch = (e) => {
      const t = e.touches?.[0];
      if (t)
        addEntropySample({
          clientX: t.clientX,
          clientY: t.clientY,
          movementX: 1,
          movementY: 1,
        });
    };
    window.addEventListener("mousemove", onMouse, { passive: true });
    window.addEventListener("touchmove", onTouch, { passive: true });
    return () => {
      window.removeEventListener("mousemove", onMouse);
      window.removeEventListener("touchmove", onTouch);
    };
  }, [collecting]);

  // Auto-finish when 100%
  useEffect(() => {
    if (collecting && ticksRef.current >= TARGET_TICKS) {
      finishCollect();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress, collecting]);

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

  return (
    <div className="app">
      {/* === INLINE MASTHEAD (ex-SiteHeader) =============================== */}
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
              href="https://github.com/ton-compte"
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
              href="https://x.com/ton-compte"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="X (Twitter)"
              title="X (Twitter)"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M18.9 2H22l-7.03 8.03L23.5 22h-6.9l-5.4-7.06L4.9 22H2l7.5-8.57L.5 2h6.9l4.88 6.38L18.9 2Zm-2.42 18h2.29L7.64 4h-2.3l11.14 16Z" />
              </svg>
            </a>
          </nav>
        </div>
      </div>

      {/* === 3-COLUMN LAYOUT ============================================== */}
      <div className="layout3">
        {/* STEP 1 — BRANDING (rail vertical 90°) */}
        <aside className="col col-left noprint">
          <section className="step-card step1">
            <div className="step-head">
              <span className="step-kicker">STEP 1</span>
              <h2 className="step-title">Branding</h2>
            </div>
            <div className="step-body">
              <div className="brand-logo">
                <div className="logo-ph">Logo</div>
              </div>

              <label className="brand-label">Wallet name</label>
              <input
                type="text"
                placeholder="ex: PaperMarty"
                className="brand-input"
                disabled
                title="À brancher plus tard"
              />
              <p className="muted" style={{ marginTop: 8 }}>
                (On choisira l’image et le nom plus tard)
              </p>
            </div>
          </section>
        </aside>

        {/* STEP 2 — GÉNÉRATION (rail vertical 90°, entropie inline) */}
        <main className="col col-center noprint">
          <section className="step-card step2">
            <div className="step-head">
              <span className="step-kicker">STEP 2</span>
              <h2 className="step-title">Génération</h2>
            </div>

            <div className="step-body">
              <p className="muted">
                Page 1 = Outside • Page 2 = Inside • Impression A4, recto/verso,
                flip court.
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
                    title="Générer sans collecte d'entropie"
                  >
                    Skip entropy
                  </button>
                </div>
              </div>

              {/* Inline entropy progress */}
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
            </div>
          </section>
        </main>

        {/* STEP 3 — PREVIEW + PRINT (rail vertical + bouton latéral) */}
        <section className="col col-right">
          <section className="step-card step3">
            {/* Rail vertical gauche : titre tourné */}
            <div className="step-head">
              <span className="step-kicker">STEP 3</span>
              <h2 className="step-title">Aperçu final</h2>
            </div>

            {/* Corps : les deux cartes */}
            <div className="step-body">
              <div className={`preview-panel ${address ? "" : "is-empty"}`}>
                <div className="preview-stage">
                  {/* ================= PAGE 1 — OUTSIDE ================= */}
                  <div className="preview-sheet">
                    <div className="sheet card-sheet outside">
                      <div className="half back">
                        <div className="pad pad-back">
                          <canvas ref={pubBackQRRef} className="qr-public" />
                          <div className="addrBlock addr-back">
                            <code className="addr">{address || "…"}</code>
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
                  </div>

                  {/* ================= PAGE 2 — INSIDE ================= */}
                  <div className="preview-sheet">
                    <div className="sheet card-sheet inside">
                      <div className="half secret-left">
                        <div className="pad pad-secret">
                          <div className="label danger">
                            SECRET — DO NOT SHARE
                          </div>
                          <div className="info">
                            <label className="label">Seed (24 words)</label>
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
                      </div>
                      <div className="half secret-right">
                        <div className="pad">
                          <div className="label">QR — Seed (24 words)</div>
                          <canvas ref={secQRRef} className="qr-seed" />
                        </div>
                      </div>
                      <div className="fold-line" aria-hidden="true" />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Rail droit : bouton print à côté des cartes */}
            <div className="step-side-print">
              <button
                className="ghost"
                onClick={() => window.print()}
                disabled={!address}
                title={address ? "Imprimer" : "Génère d’abord la carte"}
              >
                Print
              </button>
            </div>
          </section>
        </section>
      </div>
    </div>
  );
}
