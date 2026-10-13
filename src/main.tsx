import "./ui/styles/app.css";
import { render } from "preact";
import { App } from "./ui/App";
import { applyTheme } from "./ui/lib/theme";
import { startRouter } from "./ui/routes";

const root = document.getElementById("app");
if (!root) throw new Error("Missing #app root element");
applyTheme();
startRouter();
render(<App />, root);
