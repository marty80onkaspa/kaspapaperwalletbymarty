// src/components/SiteHeader.jsx
// Minimal, self-contained header with centered title, left Kaspa logo, and right social links.
// Printing is disabled via the "noprint" class (hidden by your existing @media print rules).

import React from "react";
import kaspaLogo from "../assets/kaspa-logo.png"; // ensure this path exists

export default function SiteHeader() {
  return (
    <header className="site-header noprint">
      <div className="site-header__inner">
        {/* Left: Kaspa logo */}
        <div className="site-header__left">
          <img src={kaspaLogo} alt="Kaspa logo" className="site-logo" />
        </div>

        {/* Center: Title + byline */}
        <div className="site-header__center">
          <h1 className="site-title">KASPA PAPER WALLET GENERATOR</h1>
          <div className="site-byline">
            by <strong>MARTY80</strong>
          </div>
        </div>

        {/* Right: Social links (replace hrefs with your real profiles) */}
        <nav className="site-header__right" aria-label="Social links">
          <a
            className="social-btn"
            href="https://github.com/ton-compte"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHub"
            title="GitHub"
          >
            {/* GitHub icon (inline SVG to avoid extra assets) */}
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d="M12 .5a12 12 0 0 0-3.79 23.4c.6.11.82-.25.82-.57v-2c-3.34.73-4.04-1.61-4.04-1.61-.55-1.41-1.35-1.79-1.35-1.79-1.1-.74.08-.73.08-.73 1.22.09 1.86 1.26 1.86 1.26 1.08 1.85 2.83 1.32 3.52 1.01.11-.8.42-1.32.77-1.62-2.67-.3-5.48-1.34-5.48-5.94 0-1.31.47-2.38 1.25-3.22-.13-.31-.54-1.56.12-3.25 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.28-1.55 3.29-1.23 3.29-1.23.67 1.69.26 2.94.13 3.25.78.84 1.24 1.91 1.24 3.22 0 4.61-2.81 5.64-5.49 5.93.43.37.82 1.11.82 2.25v3.34c0 .32.21.69.83.57A12 12 0 0 0 12 .5z" />
            </svg>
            <span>GitHub</span>
          </a>

          <a
            className="social-btn"
            href="https://x.com/ton-compte"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="X (Twitter)"
            title="X (Twitter)"
          >
            {/* X icon (inline SVG) */}
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d="M18.9 2H22l-7.03 8.03L23.5 22h-6.9l-5.4-7.06L4.9 22H2l7.5-8.57L.5 2h6.9l4.88 6.38L18.9 2Zm-2.42 18h2.29L7.64 4h-2.3l11.14 16Z" />
            </svg>
            <span>X</span>
          </a>
        </nav>
      </div>
    </header>
  );
}
