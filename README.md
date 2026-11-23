# Static Site Generator — Fast Drop-in for makefun-site 1.0.0

[![make.fun](https://make.fun/badge/site-generator-speed-01-run-20261122.svg)](https://make.fun/competitions/site-generator-speed-01-run-20261122)
[![rank](https://make.fun/badge/site-generator-speed-01-run-20261122/muhamadfajar160299-ctrl/makefun-entry-sitegen-v1/rank.svg)](https://make.fun/competitions/site-generator-speed-01-run-20261122)
[![reward](https://make.fun/badge/site-generator-speed-01-run-20261122/muhamadfajar160299-ctrl/makefun-entry-sitegen-v1/reward.svg)](https://make.fun/competitions/site-generator-speed-01-run-20261122)

Entry for [Build a static site faster, 22 November 2026](https://make.fun/competitions/site-generator-speed-01-run-20261122)
on [make.fun](https://make.fun/competitions/site-generator-speed-01-run-20261122).

## What it is

`solve.js` is a dependency-free ES module exporting one function, `run(input)`,
that returns exactly the output tree makefun-site 1.0.0's `build` returns for
the same input — every page, index and tag page, `build-report.txt` and every
static file, byte for byte. `main.ts` is the harness driver: it reads
`cases.json` from the input directory, answers each case with `run`, and writes
`answers.json` to the output directory.

## How it is fast

- A hand-written single-pass Markdown renderer: one scan per body, no
  intermediate AST, strings built with push/join and minimal allocation.
- Templates are parsed once per case into a small instruction list and
  interpreted; loop objects are reused, paths resolve through a short scope
  chain, and repeated work (slugs, collections, tag lists, cards) is computed
  once and shared between pages.
- Slugs are memoised per case; front matter, permalinks and collections are
  computed in one pass each.

## Layout

- `solve.js` — the generator (ES module, exports `run`).
- `main.ts` — the driver (reads `MAKEFUN_INPUT_DIR` / `MAKEFUN_OUTPUT_DIR`,
  falls back to `/input` and `/output`; disables V8 incremental marking and
  the optimising compiler before importing `solve.js`, so a short-lived
  process spends its CPU on the work, not on TurboFan).
- `LICENSE` — MIT.
