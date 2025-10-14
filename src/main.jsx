import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx"; // ← plus de dossier "ui"
import "./App.css"; // ← plus de dossier "ui"

createRoot(document.getElementById("root")).render(<App />);
