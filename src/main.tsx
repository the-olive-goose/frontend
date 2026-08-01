import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { primeContent } from "./lib/contentStore";
import "./index.css";

// Fired before the first render, not from an effect inside it: the request is
// then already in flight while React mounts, which is the difference between a
// page that paints its real copy immediately and one that paints skeletons
// first. Deliberately not awaited — the shell renders straight away and each
// section fills in as soon as the content lands.
primeContent();

createRoot(document.getElementById("root")!).render(<App />);
