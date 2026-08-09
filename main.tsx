import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/roboto";
import "@material-symbols/font-400/rounded.css";
import "./app/globals.css";
import { CastoriceApp } from "./components/CastoriceApp";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Application root element was not found.");
}

createRoot(root).render(
  <StrictMode>
    <CastoriceApp />
  </StrictMode>,
);
