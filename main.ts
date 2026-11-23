import { setFlagsFromString } from 'node:v8';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

setFlagsFromString('--no-incremental-marking');
setFlagsFromString('--no-opt');

const inputDir = process.env.MAKEFUN_INPUT_DIR || '/input';
const outputDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';

const { run } = await import(new URL('./solve.js', import.meta.url));

const cases = JSON.parse(readFileSync(inputDir + '/cases.json', 'utf8'));
const answers = [];
for (const c of cases) {
  answers.push(run(c.input));
}
mkdirSync(outputDir, { recursive: true });
writeFileSync(outputDir + '/answers.json', JSON.stringify(answers));
