import { describe, expect, test } from 'vitest';

import { highlightCode } from '../../src/highlighter.js';

describe('highlightCode', () => {
  test('highlights supported input formats', () => {
    expect(highlightCode('{"name": 1}', 'JSON', true)).toContain('hljs-attr');
    expect(highlightCode('name: Ada', 'YAML', true)).toContain('hljs-attr');
  });

  test('escapes code for languages without a bundled grammar', () => {
    const highlighted = highlightCode('value := "<unsafe>"', 'Roc');

    expect(highlighted).toContain('&lt;unsafe&gt;');
    expect(highlighted).not.toContain('<unsafe>');
  });
});
