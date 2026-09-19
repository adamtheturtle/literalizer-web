# Literalizer web

This static page runs Literalizer in a Pyodide Web Worker. The site serves the
page and a pure-Python Literalizer wheel; conversion happens in the browser.
Pyodide and the pure-Python dependencies download on first load.
Syntax highlighting is bundled locally with highlight.js, so typing and
viewing generated code do not make additional requests to a highlighting
service. Languages without a dedicated grammar get basic highlighting for
strings, numbers, and comments.

The included wheel is built from `adamtheturtle/literalizer` commit
`f41d2a15b1b5e7ca71f8afcddf7600321b09a7de` and installed with normal
dependency resolution. Its optional YAML C accelerator is excluded on
Emscripten, where `ruamel.yaml` uses its pure-Python parser.

The form covers all arguments to `literalize` and `literalize_call`, and the
composition mode covers `literalize_call_with_declarations`. Language settings
are generated from the 65 built-in language dataclasses in the wheel. JSON,
JSONC, JSON5, YAML, and TOML are available as input formats.
Function call modes list only languages that can produce calls; value mode
retains every language. An incompatible value-mode selection is restored when
returning from a call mode.
The input editor has working examples for each format and operation; switching
formats replaces an untouched example but preserves user-entered input.
Function parameters are entered as comma-separated names. Composition mode
provides an editor for each declaration's format, value, and variable, with
per-declaration JSON settings available when needed.
Python expressions, including the optional `call_transform` lambda, execute
inside Pyodide in the browser. Mapping-valued language options use JSON
`[key, value]` pairs;
`record_shape_names` keys are arrays of field names, and
`empty_container_type_hints` keys are arrays of path components.

Invalid source and option values appear in an alert above the editor. The
affected control receives focus, and source parse errors select the reported
character when Literalizer provides a line and column.

To rebuild syntax highlighting, run `npm ci && npm run build`. The generated
`dist/highlighter.js` and the library's license are committed so hosting needs
no Node build step.

To refresh the site, build a wheel from the desired Literalizer checkout with
the repository-pinned `uv` version, copy it into `dist/`, and update its filename in
`dist/worker.js`. Serve `dist/` with any static HTTP server.
