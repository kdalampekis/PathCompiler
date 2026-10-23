// Prints the reference demo narrative. Browser steps (8, 9 and the new runtime
// guide) are verified by `pnpm test:browser`.
import { runReferenceDemo, transcriptFile } from "./demo.ts";

await runReferenceDemo((line) => console.log(line));
console.log(`\nTranscript: ${transcriptFile}`);
