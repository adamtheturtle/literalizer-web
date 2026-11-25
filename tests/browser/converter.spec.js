import { expect, test } from '@playwright/test';

async function waitForConverter(page) {
  await page.goto('/');
  await page.waitForFunction(
    () =>
      document.querySelector('#output').value ||
      document.querySelector('#input-error-message').textContent,
    null,
    { timeout: 120_000 },
  );
  await expect(page.locator('#input-error-message')).toBeEmpty();
  await expect(page.locator('#output')).not.toHaveValue('');
}

test('converts data and reports invalid input', async ({ page }) => {
  await waitForConverter(page);
  await expect(page.getByRole('button', { name: 'Convert' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Load example' })).toHaveCount(0);

  await page.locator('#source').fill('{"name": "Ada"}');
  await expect(page.locator('#output')).toHaveValue(/"name": "Ada"/);
  await expect(page.locator('#status')).toBeEmpty();

  await page.locator('#source').fill('{');
  await expect(page.locator('#input-error-message')).toContainText(
    'Could not read the JSON input. Check its syntax.',
  );
  await expect(page.locator('#source')).toHaveAttribute('aria-invalid', 'true');
});

test('does not expose internal error details', async ({ page }) => {
  await waitForConverter(page);

  await page.getByText('Output options').click();
  await page.locator('#include-delimiters').uncheck();
  await page.locator('#variable-form').selectOption('NewVariable');

  await expect(page.locator('#input-error-message')).toHaveText(
    'A collection without its outer brackets cannot be saved as one variable. Include collection delimiters.',
  );
  await expect(page.locator('#input-error')).not.toContainText('include_delimiters');
  await expect(page.getByText('Technical details')).toHaveCount(0);
});

test('edits null replacements without a JSON object', async ({ page }) => {
  await waitForConverter(page);

  await page.locator('#source').fill('{"status": null}');
  await page.getByText('Output options').click();
  const editor = page.locator('#record-null-substitutions-editor');
  await editor.getByRole('button', { name: 'Add replacement' }).click();
  await editor.locator('.mapping-key').fill('status');
  await editor.locator('.mapping-value').fill('ready');

  await expect(page.locator('#output')).toHaveValue(/"status": "ready"/);
  await expect(page.getByText('Null substitutions (JSON object)')).toHaveCount(0);
});

test('shows reference controls only when references are enabled', async ({ page }) => {
  await waitForConverter(page);

  await page.getByText('Output options').click();
  await expect(page.locator('#ref-values-editor')).toBeHidden();
  await expect(page.locator('#bound-refs-editor')).toBeHidden();

  await page.locator('#source').fill('{"external":{"$ref":"shared"}}');
  await page.locator('#ref-key').fill('$ref');
  const externalValues = page.locator('#ref-values-editor');
  const declaredValues = page.locator('#bound-refs-editor');
  await expect(externalValues).toBeVisible();
  await expect(declaredValues).toBeVisible();

  await externalValues.getByRole('button', { name: 'Add value' }).click();
  await externalValues.locator('.mapping-key').fill('shared');
  await page.waitForTimeout(300);
  await expect(page.locator('#input-error-message')).toBeEmpty();
  await externalValues.locator('.mapping-value').fill('{"id": 1}');
  await expect(page.locator('#output')).toHaveValue(/"external": shared/);
  await expect(page.locator('#input-error-message')).toBeEmpty();

  await externalValues.getByRole('button', { name: 'Remove' }).click();
  await declaredValues.getByRole('button', { name: 'Add value' }).click();
  await declaredValues.locator('.mapping-key').fill('shared');
  await declaredValues.locator('.mapping-value').fill('{"id": 1}');
  await expect(page.locator('#output')).toHaveValue(/"external": shared/);
  await expect(page.locator('#input-error-message')).toBeEmpty();
});

test('keeps the editors stationary while changing creation mode', async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 900 });
  await waitForConverter(page);

  const tops = [];
  for (const mode of ['value', 'call', 'compose']) {
    await page.locator('#operation').selectOption(mode);
    tops.push((await page.locator('.panes').boundingBox()).y);
  }

  expect(new Set(tops).size).toBe(1);
});

test('shows one language option at a time', async ({ page }) => {
  await waitForConverter(page);

  await page.locator('#language-panel').getByText('Python options').click();
  await expect(page.locator('#language-options > label:visible')).toHaveCount(0);

  await page.locator('#language-option-picker').selectOption({ index: 1 });
  await expect(page.locator('#language-options > label:visible')).toHaveCount(1);

  await page.locator('#language-option-picker').selectOption({ index: 2 });
  await expect(page.locator('#language-options > label:visible')).toHaveCount(1);
});

test('only offers variable forms supported by the language and file mode', async ({ page }) => {
  await waitForConverter(page);

  await page.getByText('Output options').click();
  await page.locator('#variable-form').selectOption('NewVariable');
  await expect(page.locator('#output')).toHaveValue(/value =/);
  await page.locator('#language').selectOption('Json5');
  await expect(page.locator('#variable-form-label')).toBeHidden();
  await expect(page.locator('#variable-form')).toHaveValue('');
  await expect(page.locator('#output')).not.toHaveValue(/value =/);
  await expect(page.locator('#input-error-message')).toBeEmpty();

  await page.locator('#language').selectOption('Swift');
  await page.locator('#wrap-in-file').check();
  await expect(page.locator('#variable-form-label')).toBeHidden();
  await expect(page.locator('#variable-form')).toHaveValue('NewVariable');
  await expect(page.locator('#output')).toHaveValue(/let value =/);
  await expect(page.locator('#input-error-message')).toBeEmpty();
});

test('uses published input formats and nested TOML call rows', async ({ page }) => {
  await waitForConverter(page);
  await expect(page.locator('#format option')).toHaveText([
    'JSON',
    'JSONC',
    'JSON5',
    'YAML',
    'TOML',
  ]);
  await page.locator('#operation').selectOption('call');
  await page.locator('#format').selectOption('TOML');
  await expect(page.locator('#output')).toHaveValue('consume(value="Ada")\nconsume(value="Grace")');
  await expect(page.locator('#input-error-message')).toBeEmpty();
});

test('converts YAML comments with the browser pure-Python parser', async ({ page }) => {
  await waitForConverter(page);
  await page.locator('#format').selectOption('YAML');
  await page.locator('#source').fill('# People\nname: Ada');
  await expect(page.locator('#output')).toHaveValue(/# People/);
  await expect(page.locator('#output')).toHaveValue(/"name": "Ada"/);
  await expect(page.locator('#input-error-message')).toBeEmpty();
});

test('converts published JSONC examples in value and call modes', async ({ page }) => {
  await waitForConverter(page);
  await page.locator('#format').selectOption('JSONC');
  await expect(page.locator('#source')).toHaveValue(/Authors/);
  await expect(page.locator('#output')).toHaveValue(/"authors":/);
  await expect(page.locator('#input-error-message')).toBeEmpty();

  await page.locator('#operation').selectOption('call');
  await expect(page.locator('#source')).toHaveValue(/Call rows/);
  await expect(page.locator('#output')).toHaveValue(/consume\(value="Ada"\)/);
  await expect(page.locator('#input-error-message')).toBeEmpty();
});

test('renders invocation recipes and callable descriptions', async ({ page }) => {
  await waitForConverter(page);
  const source = page.locator('#source');
  const mode = page.getByLabel('Mode');
  const output = page.locator('#output');

  await source.fill('{"saved": true}');
  await mode.selectOption('invoke');
  await expect(output).toHaveValue('welcome(name="Ada")\nwelcome(name="Grace")');
  await source.fill(
    '{"invocation":{"default":{"target-function":"welcome","parameter-names":["name"]}},"rows":[["Linus"]]}',
  );
  await expect(output).toHaveValue('welcome(name="Linus")');

  await mode.selectOption('describe');
  await expect(output).toHaveValue('welcome(name)');
  await source.fill('{"name":"welcome","parameter-names":["name"],"return-annotation":"str"}');
  await expect(output).toHaveValue('welcome(name) -> str');

  await mode.selectOption('value');
  await expect(source).toHaveValue('{"saved": true}');
  await mode.selectOption('invoke');
  await expect(output).toHaveValue('welcome(name="Linus")');

  await page.getByLabel('Output language').selectOption('ObjectiveC');
  await source.fill(
    JSON.stringify({
      invocation: {
        receiver: { reference: 'counter', type: 'Counter' },
        selector: 'shouldSendNotification:notificationTimestamp:',
        'parameter-types': ['NSString', 'float'],
        'return-type': 'bool',
        arguments: [{ input: 0 }, { input: 1 }],
      },
      rows: [['Ada', 100.0]],
    }),
  );
  await expect(output).toHaveValue(
    '[counter shouldSendNotification:@"Ada" notificationTimestamp:100.0];',
  );
  await page.getByText('Objective-C options', { exact: true }).click();
  await page.locator('#language-option-picker').selectOption('native_argument_layout');
  await page
    .getByRole('combobox', { name: 'Native Argument Layout', exact: true })
    .selectOption('MULTILINE');
  await expect(output).toHaveValue(
    '[counter shouldSendNotification:@"Ada"\n          notificationTimestamp:100.0];',
  );
});

test('accepts a custom Elm null constructor as text', async ({ page }) => {
  await waitForConverter(page);
  await page.getByLabel('Output language').selectOption('Elm');
  await page.locator('#source').fill('null');
  await page.getByText('Elm options', { exact: true }).click();
  await page
    .getByRole('combobox', { name: 'Option', exact: true })
    .selectOption('null_constructor_name');
  await page.getByRole('textbox', { name: 'Null Constructor Name', exact: true }).fill('Missing');
  await expect(page.locator('#output')).toHaveValue(/\bMissing\b/);
});
