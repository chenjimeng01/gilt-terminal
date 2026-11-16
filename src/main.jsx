import React from "react";
import { createRoot } from "react-dom/client";
import GiltTerminal from "./GiltTerminal.jsx";
import AccessGate from "./AccessGate.jsx";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AccessGate>
      <GiltTerminal />
    </AccessGate>
  </React.StrictMode>
);
