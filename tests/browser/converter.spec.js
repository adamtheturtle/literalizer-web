import { expect, test } from '@playwright/test';

async function waitForConverter(page) {
  await page.goto('/');
  await expect(page.locator('#output')).not.toHaveValue('', { timeout: 120_000 });
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
