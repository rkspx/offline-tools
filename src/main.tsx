import "@radix-ui/themes/styles.css";
import { Theme } from "@radix-ui/themes";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import "./styles.css";

registerSW({ immediate: true });

const root = document.querySelector<HTMLDivElement>("#root");
if (!root) throw new Error("Application root was not found.");

createRoot(root).render(
  <StrictMode>
    <Theme
      appearance="inherit"
      accentColor="green"
      grayColor="sage"
      radius="medium"
      scaling="95%"
      panelBackground="solid"
    >
      <App />
    </Theme>
  </StrictMode>,
);
