# Literalizer web

This static page runs Literalizer in a Pyodide Web Worker.
The site serves the page and a pure-Python Literalizer wheel; conversion happens in the browser.
Pyodide and the pure-Python dependencies download on first load.
Syntax highlighting is bundled locally with highlight.js, so typing and viewing generated code do not make additional requests to a highlighting service.
Languages without a dedicated grammar get basic highlighting for strings, numbers, and comments.

The included wheel is the unmodified Literalizer 2026.11.4.2 release from PyPI (SHA-256 `842cdc013370503cd4de37986b946bb6444060ded3c9bc95bb427dcd62469edf`).
The worker uses normal `micropip.install(...)` dependency resolution.
The published dependency marker excludes the native YAML C accelerator on Emscripten.
`ruamel.yaml` uses its pure-Python parser in the browser.

The form covers all arguments to `literalize` and `literalize_call`, and the composition mode covers `literalize_call_with_declarations`.
Language settings are generated from the built-in language dataclasses in the wheel.
Input format choices come from the installed release: JSON, JSONC, JSON5, YAML, and TOML.
Function call modes list only languages that can produce calls; value mode retains every language.
An incompatible value-mode selection is restored when returning from a call mode.
The input editor has working examples for each format and operation; switching formats replaces an untouched example but preserves user-entered input.
Function parameters are entered as comma-separated names.
Composition mode provides an editor for each declaration's format, value, and variable, with per-declaration JSON settings available when needed.
Python expressions, including the optional `call_transform` lambda, execute inside Pyodide in the browser.
Mapping-valued language options use JSON `[key, value]` pairs; `record_shape_names` keys are arrays of field names, and `empty_container_type_hints` keys are arrays of path components.

Invalid source and option values appear in an alert above the editor.
The affected control receives focus, and source parse errors select the reported character when Literalizer provides a line and column.

To rebuild syntax highlighting, run `npm ci && npm run build`.
The generated `dist/highlighter.js` and the library's license are committed so hosting needs no Node build step.

To refresh the site, download the desired published Literalizer wheel from PyPI, verify its SHA-256, and replace the wheel in `dist/`.
Update its filename in `dist/worker.js`, its version and path in `pyproject.toml`, the release assertion in `tests/python/test_bridge.py`, and the version and SHA-256 above.
Regenerate `uv.lock` with the repository-pinned `uv` version and run the Python, JavaScript, and browser tests.
Serve `dist/` with any static HTTP server.

## Development

Install the pinned Node and Python toolchains, then run the checks:

```console
npm ci
uvx uv@0.13.0 sync --group dev
uvx uv@0.13.0 run prek run --all-files --group fast
npm test
uvx uv@0.13.0 run karva test
```

The browser tests use Chromium and load Pyodide from its CDN:

```console
npx playwright install chromium
npm run test:e2e
```

Run `npm run build` after changing `src/highlighter.js`; the generated `dist/highlighter.js` is committed so the site can be hosted as static files.
Install the Git hooks with `uvx uv@0.13.0 run prek install --hook-type pre-commit --hook-type pre-push`.
