// Runs the demo before the browser suite builds the changed (head) application.
import { runReferenceDemo } from "./demo.ts";

const transcript = await runReferenceDemo();
console.log(`Reference demo prepared at ${transcript.head.slice(0, 12)}.`);
