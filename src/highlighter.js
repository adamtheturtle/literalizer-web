import hljs from 'highlight.js';

// Use the selected language instead of guessing from a short generated snippet.
const languages = {
  CommonLisp: 'lisp', Cpp: 'cpp', CSharp: 'csharp', Erlang: 'erlang-repl',
  Json5: 'javascript', Jsonc: 'javascript', Jsonnet: 'json', Norg: 'markdown', PureScript: 'haskell',
  Racket: 'scheme', Raku: 'perl', SystemVerilog: 'verilog', Toml: 'ini',
  VisualBasic: 'vbnet',
};
const unsupported = new Set([
  'Cobol', 'Dhall', 'Forth', 'Gleam', 'Hcl', 'Mojo', 'Occam', 'Odin', 'Roc', 'V', 'Zig',
]);

function escapeHtml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function genericHighlight(code) {
  const token = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\/\/[^\n]*|#[^\n]*|\b(?:true|false|null|nil|none|undefined)\b|\b\d+(?:\.\d+)?\b)/gi;
  let html = '';
  let end = 0;
  for (const match of code.matchAll(token)) {
    html += escapeHtml(code.slice(end, match.index));
    const value = match[0];
    const kind = /^["'`]/.test(value) ? 'string' : /^(?:\/\/|#)/.test(value) ? 'comment'
      : /^\d/.test(value) ? 'number' : 'literal';
    html += `<span class="hljs-${kind}">${escapeHtml(value)}</span>`;
    end = match.index + value.length;
  }
  return html + escapeHtml(code.slice(end));
}

export function highlightCode(code, selected, input = false) {
  const language = input
    ? { JSON: 'json', JSONC: 'javascript', JSON5: 'javascript', YAML: 'yaml', TOML: 'ini' }[selected]
    : languages[selected] ?? selected.toLowerCase();
  if (unsupported.has(selected) || !hljs.getLanguage(language)) return genericHighlight(code);
  try {
    return hljs.highlight(code, { language, ignoreIllegals: true }).value;
  } catch {
    return genericHighlight(code);
  }
}
