import { Board } from "./components/Board";
import { Inspector } from "./components/Inspector";
import { ToastStack } from "./components/ToastStack";
import { Toolbar } from "./components/Toolbar";
import { LspProblems } from "./components/LspProblems";
import { createWriterState } from "./state/writer";

export default function App() {
  const writer = createWriterState();

  return (
    <main class="app-shell">
      <Toolbar writer={writer} />
      <section class="workspace">
        <Board writer={writer} />
        <Inspector writer={writer} />
        <LspProblems writer={writer} />
        <ToastStack writer={writer} />
      </section>
    </main>
  );
}
