import { highlightCode } from './highlighter.js?v=15';

const worker = new Worker(new URL('./worker.js?v=15', import.meta.url), { type: 'module' });
const $ = selector => document.querySelector(selector);
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
const convertButton = $('#convert');
const copyButton = $('#copy-output');
const status = $('#status');
const idleStatus = '';
const declarationList = $('#declaration-list');
let schema;
let result;
let nextId = 0;
let activeId = 0;
let revealOutputFor = 0;
let nextDeclarationId = 0;
let languageBeforeCall;
let callLanguageNotice = '';
const examples = {
  value: {
    JSON: '{\n  "authors": ["Ada", "Grace"],\n  "reviewers": ["Linus", "Margaret"]\n}',
    JSONC: '{\n  // People on the project\n  "authors": ["Ada", "Grace"],\n  "reviewers": ["Linus", "Margaret"]\n}',
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
  if (source.value === lastExample && $('#input-root-key').value === lastExampleRootKey) applyExample();
}

const acronyms = new Set(['API', 'ASCII', 'CSS', 'HTML', 'HTTP', 'ID', 'IEEE', 'JDK', 'JS', 'JSON', 'JSONC', 'OTP', 'PP', 'SQL', 'TOML', 'URI', 'URL', 'UTF8', 'UTF16', 'XML', 'YAML']);
const languageNames = {
  Cpp: 'C++', CSharp: 'C#', FSharp: 'F#', Hcl: 'HCL', Json5: 'JSON5', Jsonc: 'JSONC',
  Matlab: 'MATLAB', ObjectiveC: 'Objective-C', Php: 'PHP', Sml: 'SML',
  Toml: 'TOML', VisualBasic: 'Visual Basic', Yaml: 'YAML',
};
const displayLanguage = name => languageNames[name] ?? name;
function displayName(identifier) {
  if (/^V\d+(?:_\d+)+$/.test(identifier)) return `v${identifier.slice(1).replaceAll('_', '.')}`;
  if (/^PY\d\d$/.test(identifier)) return `Python ${identifier[2]}.${identifier[3]}`;
  return identifier.split('_').map(part => {
    if (acronyms.has(part.toUpperCase())) return part.toUpperCase();
    return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
  }).join(' ');
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
  try { parsed = JSON.parse(value); }
  catch (error) { throw new InputError(`${label} needs valid JSON. Check its syntax.`, selector, undefined, undefined, error.message); }
  if (shape === 'array' && !Array.isArray(parsed)) {
    throw new InputError(`${label} must be a JSON array.`, selector);
  }
  if (shape === 'object' && (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object')) {
    throw new InputError(`${label} must be a JSON object.`, selector);
  }
  return parsed;
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
    [...row.querySelectorAll('.declaration-modifiers input:checked')].map(input => input.value),
  );
  refCase.replaceChildren(
    new Option('No conversion', ''),
    ...config.ref_cases.map(name => new Option(displayName(name), name)),
  );
  if ([...refCase.options].some(option => option.value === selectedCase)) refCase.value = selectedCase;
  row.querySelector('.declaration-modifiers').replaceChildren(...config.modifiers.map(name => {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = name;
    input.checked = selectedModifiers.has(name);
    label.append(input, displayName(name));
    return label;
  }));
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
        <label>Reference case <select class="declaration-ref-case"></select></label>
        <label>Reference key <input class="declaration-ref-key" placeholder="e.g. $ref"></label>
        <label>Reference values (JSON object) <textarea class="declaration-ref-values small-code" id="declaration-ref-values-${id}" placeholder='{"name":{"id":1}}'></textarea></label>
        <label>Bound references (JSON object) <textarea class="declaration-bound-refs small-code" id="declaration-bound-refs-${id}" placeholder='{"name":{"id":1}}'></textarea></label>
        <label>Null substitutions (JSON object) <textarea class="declaration-null-substitutions small-code" id="declaration-null-substitutions-${id}" placeholder='{"field":"replacement"}'></textarea></label>
        <fieldset class="declaration-modifier-fieldset"><legend>Variable modifiers</legend><div class="declaration-modifiers"></div></fieldset>
      </div>
    </details>`;
  row.querySelector('.declaration-format').value = format.value;
  row.querySelector('.declaration-name').value = id === 1 ? 'value' : `value${id}`;
  const declarationSource = row.querySelector('.declaration-source');
  const declarationHighlight = row.querySelector('.declaration-highlight');
  const paintDeclaration = () => {
    declarationHighlight.innerHTML = highlightCode(
      declarationSource.value, row.querySelector('.declaration-format').value, true,
    ) + '\n';
    declarationHighlight.parentElement.scrollTop = declarationSource.scrollTop;
    declarationHighlight.parentElement.scrollLeft = declarationSource.scrollLeft;
  };
  const updatePlaceholder = () => {
    row.querySelector('.declaration-source').placeholder = {
      JSON: '{"id": 1}', JSONC: '{// Comment\n"id": 1}', JSON5: '{id: 1}', YAML: 'id: 1', TOML: 'id = 1',
    }[row.querySelector('.declaration-format').value];
  };
  row.querySelector('.declaration-format').addEventListener('change', () => {
    updatePlaceholder();
    paintDeclaration();
  });
  updatePlaceholder();
  paintDeclaration();
  declarationSource.addEventListener('input', paintDeclaration);
  declarationSource.addEventListener('scroll', paintDeclaration);
  row.querySelector('.declaration-form').addEventListener('change', event => {
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
  renumberDeclarations();
  declarationsChanged();
  return row;
}

function collectDeclarations() {
  const rows = [...declarationList.children];
  if (!rows.length) throw new InputError('Add a declaration, or choose Function calls.', '#add-declaration');
  return rows.map((row, index) => {
    const sourceControl = row.querySelector('.declaration-source');
    const formControl = row.querySelector('.declaration-form');
    const nameControl = row.querySelector('.declaration-name');
    if (!sourceControl.value.trim()) {
      throw new InputError(`Enter a value for declaration ${index + 1}.`, `#${sourceControl.id}`);
    }
    if (formControl.value && !nameControl.value.trim()) {
      throw new InputError(`Enter a variable name for declaration ${index + 1}.`, `#${nameControl.id}`);
    }
    const indentControl = row.querySelector('.declaration-indent');
    const indent = Number(indentControl.value);
    if (!indentControl.value.trim() || !Number.isInteger(indent) || indent < 0) {
      throw new InputError('Indent levels must be a whole number of zero or more.', `#${indentControl.id}`);
    }
    const options = {
      wrap_in_file: row.querySelector('.declaration-wrap').checked,
      include_delimiters: row.querySelector('.declaration-delimiters').checked,
      pre_indent_level: indent,
      collection_layout: row.querySelector('.declaration-layout').value,
    };
    const refCase = row.querySelector('.declaration-ref-case').value;
    if (refCase) options.ref_case = refCase;
    const refKey = row.querySelector('.declaration-ref-key').value;
    if (refKey) options.ref_key = refKey;
    for (const [selector, name, label] of [
      ['.declaration-ref-values', 'ref_values', 'Reference values'],
      ['.declaration-bound-refs', 'bound_refs', 'Bound references'],
      ['.declaration-null-substitutions', 'record_null_substitutions', 'Null substitutions'],
    ]) {
      const control = row.querySelector(selector);
      const value = parseJSON(`#${control.id}`, `Declaration ${index + 1} ${label}`, undefined, 'object');
      if (value !== undefined) options[name] = value;
    }
    if (formControl.value) {
      options.variable_form = {
        kind: formControl.value,
        name: nameControl.value.trim(),
        modifiers: ['NewVariable', 'BothVariableForms'].includes(formControl.value)
          ? [...row.querySelectorAll('.declaration-modifiers input:checked')].map(input => input.value)
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
  $('#error-details').open = false;
  document.querySelectorAll('[aria-invalid="true"]').forEach(control => control.removeAttribute('aria-invalid'));
  document.querySelectorAll('[aria-describedby="field-error"], [aria-describedby="input-error-message"]').forEach(control => control.removeAttribute('aria-describedby'));
  document.querySelectorAll('.field-error').forEach(element => element.remove());
}

function errorControl(field) {
  if (!field) return null;
  if (field.startsWith('language:')) {
    return [...document.querySelectorAll('#language-options [data-name]')]
      .find(control => control.dataset.name === field.slice(9)) ?? null;
  }
  return document.getElementById(field.replace(/^#/, ''));
}

function showError(error) {
  clearError();
  const control = errorControl(error.field);
  const hasLocation = /line\s+\d+.*column\s+\d+/i.test(error.message ?? '');
  const location = error.line && !hasLocation ? ` (line ${error.line}${error.column ? `, column ${error.column}` : ''})` : '';
  const path = error.path?.length
    ? ` In ${error.path.map(part => typeof part === 'number' ? `item ${part + 1}` : `“${part}”`).join(' → ')}.`
    : '';
  const message = `${error.message || 'Please check your input and try again.'}${location}${path}`;
  $('#input-error-message').textContent = message;
  $('#error-details').hidden = !error.detail || error.detail === error.message;
  $('#error-detail-text').textContent = error.detail ?? '';
  $('#input-error').hidden = false;
  if (control) {
    if (control.closest('#language-options > label')?.hidden) {
      $('#language-search').value = '';
      filterLanguageFields();
    }
    for (let panel = control.closest('details'); panel; panel = panel.parentElement.closest('details')) {
      panel.open = true;
    }
    control.setAttribute('aria-invalid', 'true');
    if (control === source) {
      control.setAttribute('aria-describedby', 'input-error-message');
    } else {
      if (control.parentElement.tagName !== 'LABEL') control.setAttribute('aria-describedby', 'field-error');
      const inline = document.createElement('span');
      inline.id = 'field-error';
      inline.className = 'field-error';
      inline.textContent = message;
      control.after(inline);
    }
    control.focus();
    if ((control === source || control.classList.contains('declaration-source')) && error.line && error.column) {
      const lines = control.value.split('\n');
      const before = lines.slice(0, error.line - 1).reduce((length, line) => length + line.length + 1, 0);
      const offset = Math.min(control.value.length, before + error.column - 1);
      control.setSelectionRange(offset, Math.min(offset + 1, control.value.length));
    }
  } else {
    $('#input-error').focus();
  }
  status.textContent = control ? 'Check the highlighted field and try again.' : 'Review the error and try again.';
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
  const names = Object.keys(schema.languages).filter(name => !call || schema.languages[name].call_supported);
  const preferred = call ? previous : languageBeforeCall ?? previous;
  language.replaceChildren(...names.map(name => new Option(displayLanguage(name), name)));
  language.value = names.includes(preferred) ? preferred : 'Python';
  if (!call) {
    languageBeforeCall = undefined;
    callLanguageNotice = '';
  }
  if (language.value !== previous && previous) {
    renderLanguage();
    if (call) callLanguageNotice = `${displayLanguage(previous)} cannot create function calls, so Python is selected. `;
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
  document.querySelectorAll('.call-only').forEach(element => { element.hidden = !call; });
  document.querySelectorAll('.value-only').forEach(element => { element.hidden = call; });
  document.querySelectorAll('.variable-detail').forEach(element => {
    element.hidden = !$('#variable-form').value;
  });
  if (schema && schema.languages[language.value]?.modifiers.length === 0) {
    $('#modifier-fieldset').hidden = true;
  }
  $('.mode-guidance').hidden = !call;
  $('#mode-help').hidden = operation.value === 'compose' && !callLanguageNotice;
  $('#compose-setup').hidden = operation.value !== 'compose';
  $('#mode-help').textContent = callLanguageNotice + ($('#per-element').checked
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
    field.choices.forEach(choice => control.add(new Option(displayName(choice), choice)));
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
    if (field.kind === 'string_set') control.placeholder = `JSON array override (${field.default_count} defaults)`;
    else if (field.kind === 'mapping_pairs') control.placeholder = 'JSON array of [key, value] pairs';
    else control.placeholder = 'Python expression override';
  }
  control.dataset.default = JSON.stringify(field.default ?? null);
  control.dataset.kind = field.kind;
  control.dataset.name = field.name;
  label.append(control);
  return label;
}

function filterLanguageFields() {
  const query = $('#language-search').value.trim().toLowerCase();
  let visible = 0;
  document.querySelectorAll('#language-options > label').forEach(label => {
    label.hidden = !label.dataset.field.replaceAll('_', ' ').includes(query);
    if (!label.hidden) visible++;
  });
  $('#language-no-results').hidden = visible > 0;
}

function renderLanguage() {
  const config = schema.languages[language.value];
  $('#language-options').replaceChildren(...config.fields
    .filter(field => field.kind !== 'enum' || field.choices.length + Number(field.nullable) > 1)
    .map(languageField));
  $('#ref-case').replaceChildren(
    new Option('No conversion', ''),
    ...config.ref_cases.sort().map(name => new Option(displayName(name), name)),
  );
  $('#modifiers').replaceChildren(...config.modifiers.map(name => {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = name;
    label.append(input, displayName(name));
    return label;
  }));
  $('#modifier-fieldset').hidden = config.modifiers.length === 0 || !$('#variable-form').value;
  [...declarationList.children].forEach(renderDeclarationLanguage);
  filterLanguageFields();
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
    }
    else if (kind === 'enum') value = control.value === '__none__' ? null : control.value;
    else if (kind === 'string') value = control.value;
    else if (kind === 'python') {
      if (!control.value.trim()) continue;
      value = { $python: control.value.trim() };
    } else {
      if (!control.value.trim()) continue;
      try { value = JSON.parse(control.value); }
      catch (error) { throw new InputError(`${displayName(name)} needs valid JSON. Check its syntax.`, `language:${name}`, undefined, undefined, error.message); }
      if (!Array.isArray(value)) throw new InputError(`${displayName(name)} must be a JSON array.`, `language:${name}`);
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
  if ($('#ref-case').value) options.ref_case = $('#ref-case').value;
  if (optionalText('#ref-key') !== undefined) options.ref_key = $('#ref-key').value;
  if ($('#variable-form').value) {
    const name = $('#variable-name').value;
    if (!name.trim()) throw new InputError('Enter a variable name.', '#variable-name');
    options.variable_form = {
      kind: $('#variable-form').value,
      name,
      modifiers: [...document.querySelectorAll('#modifiers input:checked')].map(input => input.value),
    };
  }
  for (const [selector, name] of [
    ['#ref-values', 'ref_values'],
    ['#bound-refs', 'bound_refs'],
  ]) {
    const value = parseJSON(selector, selector === '#ref-values' ? 'Reference values' : 'Bound references', undefined, 'object');
    if (value !== undefined) options[name] = value;
  }
  if (operation.value === 'value') {
    options.include_delimiters = $('#include-delimiters').checked;
    options.pre_indent_level = Number($('#pre-indent-level').value);
    if (!$('#pre-indent-level').value.trim() || !Number.isInteger(options.pre_indent_level) || options.pre_indent_level < 0) {
      throw new InputError('Indent levels must be a whole number of zero or more.', '#pre-indent-level');
    }
    const substitutions = parseJSON('#record-null-substitutions', 'Null substitutions', undefined, 'object');
    if (substitutions !== undefined) options.record_null_substitutions = substitutions;
  } else {
    options.target_function = $('#target-function').value;
    if (!options.target_function.trim()) throw new InputError('Enter a function name.', '#target-function');
    const names = $('#parameter-names').value.trim();
    options.parameter_names = names ? names.split(',').map(name => name.trim()) : [];
    if (options.parameter_names.some(name => !name)) {
      throw new InputError('Separate parameter names with commas, without empty entries.', '#parameter-names');
    }
    options.per_element = $('#per-element').checked;
    if (optionalText('#input-root-key') !== undefined) options.input_root_key = $('#input-root-key').value;
    if (optionalText('#call-transform') !== undefined) options.call_transform = $('#call-transform').value;
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

function clearResult(message = 'Click Convert to update the output.') {
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
    convertButton.disabled = false;
    convertButton.textContent = 'Convert';
    status.textContent = idleStatus;
    form.requestSubmit();
  } else if (data.type === 'result' && data.id === activeId) {
    clearError();
    result = data.result;
    renderOutputViews();
    showResult();
    if (data.id === revealOutputFor && matchMedia('(max-width: 740px)').matches) {
      outputDisplay.closest('.pane').scrollIntoView({
        block: 'start',
        behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      });
    }
    status.textContent = idleStatus;
    convertButton.disabled = false;
    convertButton.textContent = 'Convert';
  } else if (data.type === 'error' && (!data.id || data.id === activeId)) {
    clearResult('Check the input and try again.');
    showError(data.id === undefined
      ? { message: 'The converter could not start. Refresh the page and try again.', detail: data.message }
      : data.error ?? { message: 'Conversion failed. Check the input and try again.', detail: data.message });
    convertButton.disabled = data.id === undefined;
    convertButton.textContent = data.id === undefined ? 'Unavailable' : 'Convert';
  }
};
worker.onerror = event => {
  clearResult('Refresh the page to try again.');
  showError({ message: 'The converter stopped unexpectedly. Refresh the page and try again.', detail: event.message });
  convertButton.disabled = true;
  convertButton.textContent = 'Unavailable';
};
form.addEventListener('submit', event => {
  event.preventDefault();
  try {
    clearError();
    const request = collectRequest();
    activeId = ++nextId;
    revealOutputFor = event.submitter === convertButton ? activeId : 0;
    clearResult('Converting…');
    convertButton.disabled = true;
    convertButton.textContent = 'Converting…';
    status.textContent = 'Converting…';
    worker.postMessage({ type: 'convert', id: activeId, request });
  } catch (error) {
    clearResult('Check the input and try again.');
    showError(error);
    convertButton.disabled = false;
    convertButton.textContent = 'Convert';
  }
});
function markInputChanged(event) {
  if (event.target === outputView || event.target.id === 'language-search') return;
  if (event.target === source) paintInput();
  if (!schema || convertButton.textContent === 'Unavailable') return;
  clearError();
  if (convertButton.textContent === 'Converting…') {
    activeId = ++nextId;
    convertButton.disabled = false;
    convertButton.textContent = 'Convert';
  }
  clearResult();
  status.textContent = idleStatus;
}
form.addEventListener('input', markInputChanged);
form.addEventListener('change', markInputChanged);
operation.addEventListener('change', setVisibility);
format.addEventListener('change', setVisibility);
$('#load-example').addEventListener('click', () => {
  applyExample();
  clearError();
  clearResult();
  if (schema) {
    activeId = ++nextId;
    convertButton.disabled = false;
    convertButton.textContent = 'Convert';
    status.textContent = idleStatus;
  }
  source.focus();
});
$('#compose-setup').addEventListener('click', () => {
  $('#compose-panel').open = true;
  const row = declarationList.firstElementChild ?? addDeclaration();
  row.querySelector('.declaration-source').focus();
});
$('#add-declaration').addEventListener('click', () => {
  addDeclaration().querySelector('.declaration-source').focus();
});
$('#variable-form').addEventListener('change', setVisibility);
$('#per-element').addEventListener('change', setVisibility);
language.addEventListener('change', () => {
  if (operation.value !== 'value') {
    languageBeforeCall = undefined;
    callLanguageNotice = '';
    setVisibility();
  }
  renderLanguage();
});
$('#language-search').addEventListener('input', filterLanguageFields);
outputView.addEventListener('change', showResult);
source.addEventListener('scroll', () => {
  sourceHighlight.parentElement.scrollTop = source.scrollTop;
  sourceHighlight.parentElement.scrollLeft = source.scrollLeft;
});
copyButton.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(output.value);
    copyButton.textContent = 'Copied';
    setTimeout(() => { copyButton.textContent = 'Copy'; }, 1500);
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
