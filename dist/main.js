import { highlightCode } from './highlighter.js?v=15';

const worker = new Worker(new URL('./worker.js?v=15', import.meta.url), { type: 'module' });
const $ = (selector) => document.querySelector(selector);
const form = $('#converter');
const operation = $('#operation');
const format = $('#format');
const language = $('#language');
const source = $('#source');
const output = $('#output');
const outputDisplay = $('#output-display');
const outputHighlight = $('#output-highlight');
const sourceHighlight = $('#source-highlight');
const outputView = $('#output-view');
const copyButton = $('#copy-output');
const status = $('#status');
const idleStatus = '';
const declarationList = $('#declaration-list');
let schema;
let result;
let nextId = 0;
let activeId = 0;
let conversionTimer;
let converterAvailable = false;
let nextDeclarationId = 0;
let languageBeforeCall;
let callLanguageNotice = '';
let nextMappingId = 0;
const examples = {
  value: {
    JSON: '{\n  "authors": ["Ada", "Grace"],\n  "reviewers": ["Linus", "Margaret"]\n}',
    JSONC:
      '{\n  // People on the project\n  "authors": ["Ada", "Grace"],\n  "reviewers": ["Linus", "Margaret"]\n}',
    JSON5: "{\n  authors: ['Ada', 'Grace'],\n  reviewers: ['Linus', 'Margaret']\n}",
    YAML: 'authors:\n  - Ada\n  - Grace\nreviewers:\n  - Linus\n  - Margaret',
    TOML: 'authors = ["Ada", "Grace"]\nreviewers = ["Linus", "Margaret"]',
  },
  call: {
    JSON: '[\n  ["Ada"],\n  ["Grace"]\n]',
    JSONC: '[\n  // One row per call\n  ["Ada"],\n  ["Grace"]\n]',
    JSON5: "[\n  ['Ada'],\n  ['Grace']\n]",
    YAML: '- [Ada]\n- [Grace]',
    TOML: 'calls = [["Ada"], ["Grace"]]',
  },
};
let lastExample = source.value;
let lastExampleRootKey = '';

function selectedExample() {
  const call = operation.value !== 'value';
  return {
    source: examples[call ? 'call' : 'value'][format.value],
    rootKey: call && format.value === 'TOML' ? 'calls' : '',
  };
}

function applyExample() {
  const example = selectedExample();
  source.value = example.source;
  $('#input-root-key').value = example.rootKey;
  lastExample = example.source;
  lastExampleRootKey = example.rootKey;
  paintInput();
}

function paintInput() {
  sourceHighlight.innerHTML = highlightCode(source.value, format.value, true) + '\n';
  sourceHighlight.parentElement.scrollTop = source.scrollTop;
  sourceHighlight.parentElement.scrollLeft = source.scrollLeft;
}

function updateExampleIfPristine() {
  if (source.value === lastExample && $('#input-root-key').value === lastExampleRootKey)
    applyExample();
}

const acronyms = new Set([
  'API',
  'ASCII',
  'CSS',
  'HTML',
  'HTTP',
  'ID',
  'IEEE',
  'JDK',
  'JS',
  'JSON',
  'JSONC',
  'OTP',
  'PP',
  'SQL',
  'TOML',
  'URI',
  'URL',
  'UTF8',
  'UTF16',
  'XML',
  'YAML',
]);
const languageNames = {
  Cpp: 'C++',
  CSharp: 'C#',
  FSharp: 'F#',
  Hcl: 'HCL',
  Json5: 'JSON5',
  Jsonc: 'JSONC',
  Matlab: 'MATLAB',
  ObjectiveC: 'Objective-C',
  Php: 'PHP',
  Sml: 'SML',
  Toml: 'TOML',
  VisualBasic: 'Visual Basic',
  Yaml: 'YAML',
};
const displayLanguage = (name) => languageNames[name] ?? name;
function displayName(identifier) {
  if (/^V\d+(?:_\d+)+$/.test(identifier)) return `v${identifier.slice(1).replaceAll('_', '.')}`;
  if (/^PY\d\d$/.test(identifier)) return `Python ${identifier[2]}.${identifier[3]}`;
  return identifier
    .split('_')
    .map((part) => {
      if (acronyms.has(part.toUpperCase())) return part.toUpperCase();
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(' ');
}

class InputError extends Error {
  constructor(message, field, line, column, detail) {
    super(message);
    this.field = field;
    this.line = line;
    this.column = column;
    this.detail = detail;
  }
}

function parseJSON(selector, label, emptyValue, shape) {
  const value = $(selector).value.trim();
  if (!value) return emptyValue;
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new InputError(
      `${label} needs valid JSON. Check its syntax.`,
      selector,
      undefined,
      undefined,
      error.message,
    );
  }
  if (shape === 'array' && !Array.isArray(parsed)) {
    throw new InputError(`${label} must be a JSON array.`, selector);
  }
  if (
    shape === 'object' &&
    (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object')
  ) {
    throw new InputError(`${label} must be a JSON object.`, selector);
  }
  return parsed;
}

function addMappingRow(editor) {
  const id = ++nextMappingId;
  const row = document.createElement('div');
  row.className = 'mapping-row';
  row.innerHTML = `
    <label>${editor.dataset.keyLabel}<input class="mapping-key" id="mapping-key-${id}" type="text"></label>
    <label>${editor.dataset.valueLabel}<input class="mapping-value" id="mapping-value-${id}" type="text" placeholder="Text, number, true, or JSON"></label>
    <button type="button" class="text-button remove-mapping-row">Remove</button>
    <small>Plain text needs no quotes. Use JSON for arrays and objects.</small>`;
  editor.querySelector('.mapping-rows').append(row);
  row.querySelector('.remove-mapping-row').addEventListener('click', () => {
    row.remove();
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  });
  row.querySelector('.mapping-key').focus();
}

function parseMappingValue(control, label) {
  const sourceValue = control.value.trim();
  if (!sourceValue) throw new InputError(`Enter ${label.toLowerCase()}.`, `#${control.id}`);
  try {
    return JSON.parse(sourceValue);
  } catch (error) {
    if (/^(?:\{|\[|"|true$|false$|null$|-?\d)/.test(sourceValue)) {
      throw new InputError(
        `${label} needs valid JSON, or enter plain text without quotes.`,
        `#${control.id}`,
        undefined,
        undefined,
        error.message,
      );
    }
    return sourceValue;
  }
}

function collectMapping(editorOrSelector) {
  const editor = typeof editorOrSelector === 'string' ? $(editorOrSelector) : editorOrSelector;
  const result = {};
  for (const row of editor.querySelectorAll('.mapping-row')) {
    const keyControl = row.querySelector('.mapping-key');
    const valueControl = row.querySelector('.mapping-value');
    const key = keyControl.value.trim();
    if (!key && !valueControl.value.trim()) continue;
    if (!key)
      throw new InputError(`Enter ${editor.dataset.keyLabel.toLowerCase()}.`, `#${keyControl.id}`);
    if (Object.hasOwn(result, key)) {
      throw new InputError(`${key} is listed more than once.`, `#${keyControl.id}`);
    }
    result[key] = parseMappingValue(valueControl, editor.dataset.valueLabel);
  }
  return Object.keys(result).length ? result : undefined;
}

function renumberDeclarations() {
  [...declarationList.children].forEach((row, index) => {
    row.querySelector('.declaration-number').textContent = `Declaration ${index + 1}`;
  });
}

function declarationsChanged() {
  clearError();
  if (schema) status.textContent = idleStatus;
  declarationList.dispatchEvent(new Event('input', { bubbles: true }));
}

function renderDeclarationLanguage(row) {
  if (!schema) return;
  const config = schema.languages[language.value];
  const refCase = row.querySelector('.declaration-ref-case');
  const selectedCase = refCase.value;
  const selectedModifiers = new Set(
    [...row.querySelectorAll('.declaration-modifiers input:checked')].map((input) => input.value),
  );
  refCase.replaceChildren(
    new Option('No conversion', ''),
    ...config.ref_cases.map((name) => new Option(displayName(name), name)),
  );
  if ([...refCase.options].some((option) => option.value === selectedCase))
    refCase.value = selectedCase;
  row.querySelector('.declaration-modifiers').replaceChildren(
    ...config.modifiers.map((name) => {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = name;
      input.checked = selectedModifiers.has(name);
      label.append(input, displayName(name));
      return label;
    }),
  );
  const formKind = row.querySelector('.declaration-form').value;
  row.querySelector('.declaration-modifier-fieldset').hidden =
    config.modifiers.length === 0 || !['NewVariable', 'BothVariableForms'].includes(formKind);
}

function addDeclaration() {
  const id = ++nextDeclarationId;
  const row = document.createElement('article');
  row.className = 'declaration-card';
  row.innerHTML = `
    <div class="declaration-heading"><strong class="declaration-number"></strong><button class="remove-declaration text-button" type="button">Remove</button></div>
    <div class="declaration-fields">
      <label>From <select class="declaration-format" id="declaration-format-${id}"><option>JSON</option><option>JSONC</option><option>JSON5</option><option>YAML</option><option>TOML</option></select></label>
      <label>Save as <select class="declaration-form" id="declaration-form-${id}"><option value="">Just the value</option><option value="NewVariable" selected>New variable</option><option value="ExistingVariable">Existing variable</option><option value="BothVariableForms">Declare and assign</option></select></label>
      <label class="declaration-name-label">Variable name <input class="declaration-name" id="declaration-name-${id}" value="value"></label>
      <label class="declaration-source-label">Value
        <div class="declaration-code-editor">
          <pre class="code-highlighting" aria-hidden="true"><code class="declaration-highlight"></code></pre>
          <textarea class="declaration-source" id="declaration-source-${id}" spellcheck="false" placeholder='{"id": 1}'></textarea>
        </div>
      </label>
    </div>
    <details class="declaration-more"><summary>Value settings</summary>
      <div class="option-grid">
        <label class="check"><input class="declaration-wrap" id="declaration-wrap-${id}" type="checkbox"> Generate complete file</label>
        <label class="check"><input class="declaration-delimiters" id="declaration-delimiters-${id}" type="checkbox" checked> Include collection delimiters</label>
        <label>Indent levels <input class="declaration-indent" id="declaration-indent-${id}" type="number" min="0" value="0"></label>
        <label>Collection layout <select class="declaration-layout"><option value="COMPACT">Compact</option><option value="MULTILINE">Multiline</option></select></label>
        <label class="declaration-reference-detail" hidden>Reference case <select class="declaration-ref-case"></select></label>
        <label>Variable reference key <input class="declaration-ref-key" placeholder="e.g. $ref"><small>Objects such as {"$ref":"name"} become variable references.</small></label>
        <fieldset class="mapping-editor declaration-ref-values-editor declaration-reference-detail" data-key-label="Reference name" data-value-label="Example value" hidden>
          <legend>Values defined elsewhere</legend><p>Describe referenced variables so their types and imports can be inferred.</p>
          <div class="mapping-rows"></div><button type="button" class="secondary add-mapping-row">Add value</button>
        </fieldset>
        <fieldset class="mapping-editor declaration-bound-refs-editor declaration-reference-detail" data-key-label="Reference name" data-value-label="Value to declare" hidden>
          <legend>Values to declare</legend><p>Define referenced variables in the generated complete file.</p>
          <div class="mapping-rows"></div><button type="button" class="secondary add-mapping-row">Add value</button>
        </fieldset>
        <fieldset class="mapping-editor declaration-null-substitutions-editor" data-key-label="Field name" data-value-label="Replacement">
          <legend>Replace null fields</legend><p>Use a replacement when a named object field is null.</p>
          <div class="mapping-rows"></div><button type="button" class="secondary add-mapping-row">Add replacement</button>
        </fieldset>
        <fieldset class="declaration-modifier-fieldset"><legend>Variable modifiers</legend><div class="declaration-modifiers"></div></fieldset>
      </div>
    </details>`;
  row.querySelector('.declaration-format').value = format.value;
  row.querySelector('.declaration-name').value = id === 1 ? 'value' : `value${id}`;
  const declarationSource = row.querySelector('.declaration-source');
  const declarationHighlight = row.querySelector('.declaration-highlight');
  const paintDeclaration = () => {
    declarationHighlight.innerHTML =
      highlightCode(declarationSource.value, row.querySelector('.declaration-format').value, true) +
      '\n';
    declarationHighlight.parentElement.scrollTop = declarationSource.scrollTop;
    declarationHighlight.parentElement.scrollLeft = declarationSource.scrollLeft;
  };
  const updatePlaceholder = () => {
    row.querySelector('.declaration-source').placeholder = {
      JSON: '{"id": 1}',
      JSONC: '{// Comment\n"id": 1}',
      JSON5: '{id: 1}',
      YAML: 'id: 1',
      TOML: 'id = 1',
    }[row.querySelector('.declaration-format').value];
  };
  const updateReferenceVisibility = () => {
    const hidden = !row.querySelector('.declaration-ref-key').value.trim();
    row.querySelectorAll('.declaration-reference-detail').forEach((element) => {
      element.hidden = hidden;
    });
  };
  row.querySelector('.declaration-format').addEventListener('change', () => {
    updatePlaceholder();
    paintDeclaration();
  });
  updatePlaceholder();
  paintDeclaration();
  declarationSource.addEventListener('input', paintDeclaration);
  declarationSource.addEventListener('scroll', paintDeclaration);
  row.querySelector('.declaration-ref-key').addEventListener('input', updateReferenceVisibility);
  row.querySelector('.declaration-form').addEventListener('change', (event) => {
    row.querySelector('.declaration-name-label').hidden = !event.target.value;
    renderDeclarationLanguage(row);
  });
  row.querySelector('.remove-declaration').addEventListener('click', () => {
    row.remove();
    renumberDeclarations();
    declarationsChanged();
    $('#add-declaration').focus();
  });
  declarationList.append(row);
  renderDeclarationLanguage(row);
  updateReferenceVisibility();
  renumberDeclarations();
  declarationsChanged();
  return row;
}

function collectDeclarations() {
  const rows = [...declarationList.children];
  if (!rows.length)
    throw new InputError('Add a declaration, or choose Function calls.', '#add-declaration');
  return rows.map((row, index) => {
    const sourceControl = row.querySelector('.declaration-source');
    const formControl = row.querySelector('.declaration-form');
    const nameControl = row.querySelector('.declaration-name');
    if (!sourceControl.value.trim()) {
      throw new InputError(`Enter a value for declaration ${index + 1}.`, `#${sourceControl.id}`);
    }
    if (formControl.value && !nameControl.value.trim()) {
      throw new InputError(
        `Enter a variable name for declaration ${index + 1}.`,
        `#${nameControl.id}`,
      );
    }
    const indentControl = row.querySelector('.declaration-indent');
    const indent = Number(indentControl.value);
    if (!indentControl.value.trim() || !Number.isInteger(indent) || indent < 0) {
      throw new InputError(
        'Indent levels must be a whole number of zero or more.',
        `#${indentControl.id}`,
      );
    }
    const options = {
      wrap_in_file: row.querySelector('.declaration-wrap').checked,
      include_delimiters: row.querySelector('.declaration-delimiters').checked,
      pre_indent_level: indent,
      collection_layout: row.querySelector('.declaration-layout').value,
    };
    const refKey = row.querySelector('.declaration-ref-key').value;
    if (refKey) {
      options.ref_key = refKey;
      const refCase = row.querySelector('.declaration-ref-case').value;
      if (refCase) options.ref_case = refCase;
      for (const [selector, name] of [
        ['.declaration-ref-values-editor', 'ref_values'],
        ['.declaration-bound-refs-editor', 'bound_refs'],
      ]) {
        const value = collectMapping(row.querySelector(selector));
        if (value !== undefined) options[name] = value;
      }
    }
    for (const [selector, name] of [
      ['.declaration-null-substitutions-editor', 'record_null_substitutions'],
    ]) {
      const value = collectMapping(row.querySelector(selector));
      if (value !== undefined) options[name] = value;
    }
    if (formControl.value) {
      options.variable_form = {
        kind: formControl.value,
        name: nameControl.value.trim(),
        modifiers: ['NewVariable', 'BothVariableForms'].includes(formControl.value)
          ? [...row.querySelectorAll('.declaration-modifiers input:checked')].map(
              (input) => input.value,
            )
          : [],
      };
    }
    return {
      format: row.querySelector('.declaration-format').value,
      source: sourceControl.value,
      options,
      ui_field: sourceControl.id,
      ui_fields: {
        source: sourceControl.id,
        'variable-form': formControl.id,
        'variable-name': nameControl.id,
        'wrap-in-file': row.querySelector('.declaration-wrap').id,
        'include-delimiters': row.querySelector('.declaration-delimiters').id,
        'pre-indent-level': indentControl.id,
      },
    };
  });
}

function clearError() {
  $('#input-error').hidden = true;
  document
    .querySelectorAll('[aria-invalid="true"]')
    .forEach((control) => control.removeAttribute('aria-invalid'));
  document
    .querySelectorAll('[aria-describedby="field-error"], [aria-describedby="input-error-message"]')
    .forEach((control) => control.removeAttribute('aria-describedby'));
  document.querySelectorAll('.field-error').forEach((element) => element.remove());
}

function errorControl(field) {
  if (!field) return null;
  if (field.startsWith('language:')) {
    return (
      [...document.querySelectorAll('#language-options [data-name]')].find(
        (control) => control.dataset.name === field.slice(9),
      ) ?? null
    );
  }
  return document.getElementById(field.replace(/^#/, ''));
}

function showError(error) {
  clearError();
  const control = errorControl(error.field);
  const hasLocation = /line\s+\d+.*column\s+\d+/i.test(error.message ?? '');
  const location =
    error.line && !hasLocation
      ? ` (line ${error.line}${error.column ? `, column ${error.column}` : ''})`
      : '';
  const path = error.path?.length
    ? ` In ${error.path.map((part) => (typeof part === 'number' ? `item ${part + 1}` : `“${part}”`)).join(' → ')}.`
    : '';
  const message = `${error.message || 'Please check your input and try again.'}${location}${path}`;
  $('#input-error-message').textContent = message;
  $('#input-error').hidden = false;
  if (control) {
    const languageLabel = control.closest('#language-options > label');
    if (languageLabel?.hidden) {
      $('#language-option-picker').value = languageLabel.dataset.field;
      showLanguageField(languageLabel.dataset.field);
    }
    for (
      let panel = control.closest('details');
      panel;
      panel = panel.parentElement.closest('details')
    ) {
      panel.open = true;
    }
    control.setAttribute('aria-invalid', 'true');
    if (control === source) {
      control.setAttribute('aria-describedby', 'input-error-message');
    } else {
      if (control.parentElement.tagName !== 'LABEL')
        control.setAttribute('aria-describedby', 'field-error');
      const inline = document.createElement('span');
      inline.id = 'field-error';
      inline.className = 'field-error';
      inline.textContent = message;
      control.after(inline);
    }
  }
  status.textContent = control
    ? 'Check the highlighted field and try again.'
    : 'Review the error and try again.';
}

function optionalText(selector) {
  return $(selector).value === '' ? undefined : $(selector).value;
}

function enteredLines(selector) {
  const value = $(selector).value.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  return value ? value.split('\n') : [];
}

function updateLanguageChoices() {
  const call = operation.value !== 'value';
  const previous = language.value;
  if (call && schema.languages[previous]?.call_supported === false) {
    languageBeforeCall = previous;
  }
  const names = Object.keys(schema.languages).filter(
    (name) => !call || schema.languages[name].call_supported,
  );
  const preferred = call ? previous : (languageBeforeCall ?? previous);
  language.replaceChildren(...names.map((name) => new Option(displayLanguage(name), name)));
  language.value = names.includes(preferred) ? preferred : 'Python';
  if (!call) {
    languageBeforeCall = undefined;
    callLanguageNotice = '';
  }
  if (language.value !== previous && previous) {
    renderLanguage();
    if (call)
      callLanguageNotice = `${displayLanguage(previous)} cannot create function calls, so Python is selected. `;
  }
}

function setVisibility() {
  if (schema) updateLanguageChoices();
  updateExampleIfPristine();
  paintInput();
  const call = operation.value !== 'value';
  $('.language-control').classList.toggle('full-row', !call);
  $('#call-panel').hidden = !call;
  $('#compose-panel').hidden = operation.value !== 'compose';
  document.querySelectorAll('.call-only').forEach((element) => {
    element.hidden = !call;
  });
  document.querySelectorAll('.value-only').forEach((element) => {
    element.hidden = call;
  });
  document.querySelectorAll('.variable-detail').forEach((element) => {
    element.hidden = !$('#variable-form').value;
  });
  document.querySelectorAll('.reference-detail').forEach((element) => {
    element.hidden = !$('#ref-key').value.trim();
  });
  if (schema && schema.languages[language.value]?.modifiers.length === 0) {
    $('#modifier-fieldset').hidden = true;
  }
  $('.mode-guidance').classList.toggle('is-empty', !call);
  $('.mode-guidance').setAttribute('aria-hidden', String(!call));
  $('#mode-help').hidden = operation.value === 'compose' && !callLanguageNotice;
  $('#compose-setup').hidden = operation.value !== 'compose';
  $('#mode-help').textContent =
    callLanguageNotice +
    ($('#per-element').checked
      ? 'Each input row becomes a function call.'
      : 'The input becomes one function call.');
}

function languageField(field) {
  const label = document.createElement('label');
  label.dataset.field = field.name;
  label.textContent = displayName(field.name);
  let control;
  if (field.kind === 'enum') {
    control = document.createElement('select');
    if (field.nullable) control.add(new Option('None', '__none__'));
    field.choices.forEach((choice) => control.add(new Option(displayName(choice), choice)));
    control.value = field.default ?? '__none__';
  } else if (field.kind === 'bool') {
    control = document.createElement('input');
    control.type = 'checkbox';
    control.checked = field.default;
  } else if (field.kind === 'string' || field.kind === 'integer') {
    control = document.createElement('input');
    control.type = field.kind === 'integer' ? 'number' : 'text';
    control.value = field.default;
  } else {
    control = document.createElement('textarea');
    control.className = 'small-code';
    if (field.kind === 'string_set')
      control.placeholder = `JSON array override (${field.default_count} defaults)`;
    else if (field.kind === 'mapping_pairs')
      control.placeholder = 'JSON array of [key, value] pairs';
    else control.placeholder = 'Python expression override';
  }
  control.dataset.default = JSON.stringify(field.default ?? null);
  control.dataset.kind = field.kind;
  control.dataset.name = field.name;
  label.append(control);
  return label;
}

function showLanguageField(name) {
  document.querySelectorAll('#language-options > label').forEach((label) => {
    label.hidden = label.dataset.field !== name;
  });
}

function renderLanguage() {
  const config = schema.languages[language.value];
  const fields = config.fields.filter(
    (field) => field.kind !== 'enum' || field.choices.length + Number(field.nullable) > 1,
  );
  const controls = fields.map(languageField);
  controls.forEach((control) => {
    control.hidden = true;
  });
  $('#language-options').replaceChildren(...controls);
  $('#language-option-picker').replaceChildren(
    new Option('Choose an option…', ''),
    ...fields.map((field) => new Option(displayName(field.name), field.name)),
  );
  $('#language-options-summary').textContent = `${displayLanguage(language.value)} options`;
  $('#language-panel').hidden = fields.length === 0;
  $('#ref-case').replaceChildren(
    new Option('No conversion', ''),
    ...config.ref_cases.sort().map((name) => new Option(displayName(name), name)),
  );
  $('#modifiers').replaceChildren(
    ...config.modifiers.map((name) => {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = name;
      label.append(input, displayName(name));
      return label;
    }),
  );
  $('#modifier-fieldset').hidden = config.modifiers.length === 0 || !$('#variable-form').value;
  [...declarationList.children].forEach(renderDeclarationLanguage);
}

function collectLanguageOptions() {
  const options = {};
  for (const control of document.querySelectorAll('#language-options [data-kind]')) {
    const { kind, name } = control.dataset;
    const defaultValue = JSON.parse(control.dataset.default);
    let value;
    if (kind === 'bool') value = control.checked;
    else if (kind === 'integer') {
      value = Number(control.value);
      if (!control.value.trim() || !Number.isInteger(value)) {
        throw new InputError(`${displayName(name)} must be a whole number.`, `language:${name}`);
      }
    } else if (kind === 'enum') value = control.value === '__none__' ? null : control.value;
    else if (kind === 'string') value = control.value;
    else if (kind === 'python') {
      if (!control.value.trim()) continue;
      value = { $python: control.value.trim() };
    } else {
      if (!control.value.trim()) continue;
      try {
        value = JSON.parse(control.value);
      } catch (error) {
        throw new InputError(
          `${displayName(name)} needs valid JSON. Check its syntax.`,
          `language:${name}`,
          undefined,
          undefined,
          error.message,
        );
      }
      if (!Array.isArray(value))
        throw new InputError(`${displayName(name)} must be a JSON array.`, `language:${name}`);
    }
    if (JSON.stringify(value) !== JSON.stringify(defaultValue)) options[name] = value;
  }
  return options;
}

function collectOptions() {
  const options = {
    wrap_in_file: $('#wrap-in-file').checked,
    collection_layout: $('#collection-layout').value,
  };
  const refKey = optionalText('#ref-key');
  if (refKey !== undefined) {
    options.ref_key = refKey;
    if ($('#ref-case').value) options.ref_case = $('#ref-case').value;
    const refValues = collectMapping('#ref-values-editor');
    if (refValues !== undefined) options.ref_values = refValues;
    const boundRefs = collectMapping('#bound-refs-editor');
    if (boundRefs !== undefined) options.bound_refs = boundRefs;
  }
  if ($('#variable-form').value) {
    const name = $('#variable-name').value;
    if (!name.trim()) throw new InputError('Enter a variable name.', '#variable-name');
    options.variable_form = {
      kind: $('#variable-form').value,
      name,
      modifiers: [...document.querySelectorAll('#modifiers input:checked')].map(
        (input) => input.value,
      ),
    };
  }
  if (operation.value === 'value') {
    options.include_delimiters = $('#include-delimiters').checked;
    options.pre_indent_level = Number($('#pre-indent-level').value);
    if (
      !$('#pre-indent-level').value.trim() ||
      !Number.isInteger(options.pre_indent_level) ||
      options.pre_indent_level < 0
    ) {
      throw new InputError(
        'Indent levels must be a whole number of zero or more.',
        '#pre-indent-level',
      );
    }
    const substitutions = collectMapping('#record-null-substitutions-editor');
    if (substitutions !== undefined) options.record_null_substitutions = substitutions;
  } else {
    options.target_function = $('#target-function').value;
    if (!options.target_function.trim())
      throw new InputError('Enter a function name.', '#target-function');
    const names = $('#parameter-names').value.trim();
    options.parameter_names = names ? names.split(',').map((name) => name.trim()) : [];
    if (options.parameter_names.some((name) => !name)) {
      throw new InputError(
        'Separate parameter names with commas, without empty entries.',
        '#parameter-names',
      );
    }
    options.per_element = $('#per-element').checked;
    if (optionalText('#input-root-key') !== undefined)
      options.input_root_key = $('#input-root-key').value;
    if (optionalText('#call-transform') !== undefined)
      options.call_transform = $('#call-transform').value;
    if (optionalText('#zip-source') !== undefined) {
      options.zip_source = $('#zip-source').value;
      options.zip_input_format = $('#zip-input-format').value || format.value;
    }
    const comments = parseJSON('#comment-source', 'Comment source', undefined, 'array');
    if (comments !== undefined) options.comment_source = comments;
    const consumable = parseJSON('#consumable-refs', 'Consumable references', undefined, 'array');
    if (consumable !== undefined) options.consumable_refs = consumable;
  }
  return options;
}

function collectRequest() {
  const request = {
    operation: operation.value,
    source: source.value,
    format: format.value,
    language: language.value,
    language_label: language.selectedOptions[0]?.text ?? language.value,
    language_options: collectLanguageOptions(),
    options: collectOptions(),
  };
  if (operation.value === 'compose') {
    request.declarations = collectDeclarations();
    request.extra_preamble = enteredLines('#extra-preamble');
    request.extra_body_preamble = enteredLines('#extra-body-preamble');
  }
  return request;
}

function showResult() {
  if (!result) return;
  output.value = result[outputView.value] ?? '';
  outputHighlight.innerHTML = output.value ? highlightCode(output.value, language.value) : '';
  outputHighlight.dataset.placeholder = 'No code was produced.';
  outputDisplay.scrollTop = 0;
  outputDisplay.scrollLeft = 0;
  copyButton.disabled = !output.value;
}

function renderOutputViews() {
  const labels = {
    code: 'All code',
    bare_code: 'Without generated setup',
    declaration_code: 'Main code only',
  };
  const previous = outputView.value;
  const seen = new Set();
  const views = Object.entries(labels).filter(([name]) => {
    const value = result[name];
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
  outputView.replaceChildren(...views.map(([name, label]) => new Option(label, name)));
  outputView.value = views.some(([name]) => name === previous) ? previous : 'code';
  outputView.hidden = views.length < 2;
}

function clearResult(message = 'Waiting for input…') {
  result = undefined;
  output.value = '';
  outputHighlight.textContent = '';
  outputHighlight.dataset.placeholder = message;
  copyButton.disabled = true;
  outputView.hidden = true;
}

worker.onmessage = ({ data }) => {
  if (data.type === 'ready') {
    schema = data.schema;
    updateLanguageChoices();
    renderLanguage();
    language.disabled = false;
    converterAvailable = true;
    status.textContent = idleStatus;
    scheduleConversion();
  } else if (data.type === 'result' && data.id === activeId) {
    clearError();
    result = data.result;
    renderOutputViews();
    showResult();
    status.textContent = idleStatus;
  } else if (data.type === 'error' && (!data.id || data.id === activeId)) {
    clearResult('Check the input and try again.');
    showError(
      data.id === undefined
        ? {
            message: 'The converter could not start. Refresh the page and try again.',
            detail: data.message,
          }
        : (data.error ?? {
            message: 'Conversion failed. Check the input and try again.',
            detail: data.message,
          }),
    );
    if (data.id === undefined) converterAvailable = false;
  }
};
worker.onerror = (event) => {
  clearResult('Refresh the page to try again.');
  showError({
    message: 'The converter stopped unexpectedly. Refresh the page and try again.',
    detail: event.message,
  });
  converterAvailable = false;
};

function convert(id) {
  if (operation.value === 'compose') {
    const declarations = [...declarationList.querySelectorAll('.declaration-source')];
    if (declarations.length === 0 || declarations.some((control) => !control.value.trim())) {
      clearError();
      clearResult(
        declarations.length === 0
          ? 'Add a declaration to generate code.'
          : 'Enter a value for each declaration.',
      );
      return;
    }
  }
  try {
    clearError();
    const request = collectRequest();
    clearResult('Converting…');
    worker.postMessage({ type: 'convert', id, request });
  } catch (error) {
    clearResult('Check the input and try again.');
    showError(error);
  }
}

function scheduleConversion(delay = 0) {
  if (!schema || !converterAvailable) return;
  clearTimeout(conversionTimer);
  activeId = ++nextId;
  const id = activeId;
  conversionTimer = setTimeout(() => convert(id), delay);
}

function markInputChanged(event) {
  if (event.target === outputView || event.target.id === 'language-option-picker') return;
  if (event.target === source) paintInput();
  if (!schema || !converterAvailable) return;
  clearError();
  status.textContent = idleStatus;
  scheduleConversion(event.type === 'input' ? 250 : 0);
}
form.addEventListener('input', markInputChanged);
form.addEventListener('change', markInputChanged);
form.addEventListener('click', (event) => {
  const button = event.target.closest('.add-mapping-row');
  if (button) addMappingRow(button.closest('.mapping-editor'));
});
operation.addEventListener('change', setVisibility);
format.addEventListener('change', setVisibility);
$('#compose-setup').addEventListener('click', () => {
  $('#compose-panel').open = true;
  const row = declarationList.firstElementChild ?? addDeclaration();
  row.querySelector('.declaration-source').focus();
});
$('#add-declaration').addEventListener('click', () => {
  addDeclaration().querySelector('.declaration-source').focus();
});
$('#variable-form').addEventListener('change', setVisibility);
$('#ref-key').addEventListener('input', setVisibility);
$('#per-element').addEventListener('change', setVisibility);
language.addEventListener('change', () => {
  if (operation.value !== 'value') {
    languageBeforeCall = undefined;
    callLanguageNotice = '';
    setVisibility();
  }
  renderLanguage();
});
$('#language-option-picker').addEventListener('change', (event) => {
  showLanguageField(event.target.value);
  if (event.target.value) {
    $(`#language-options [data-name="${CSS.escape(event.target.value)}"]`).focus();
  }
});
outputView.addEventListener('change', showResult);
source.addEventListener('scroll', () => {
  sourceHighlight.parentElement.scrollTop = source.scrollTop;
  sourceHighlight.parentElement.scrollLeft = source.scrollLeft;
});
copyButton.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(output.value);
    copyButton.textContent = 'Copied';
    setTimeout(() => {
      copyButton.textContent = 'Copy';
    }, 1500);
  } catch {
    outputDisplay.focus();
    const range = document.createRange();
    range.selectNodeContents(outputHighlight);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    status.textContent = 'Select and copy the output.';
  }
});
setVisibility();
