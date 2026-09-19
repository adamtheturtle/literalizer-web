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
