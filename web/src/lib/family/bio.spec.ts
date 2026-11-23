import { renderBio } from '#lib/family/bio.ts';

describe(renderBio.name, () => {
  it('renders paragraphs, bold, italic and links', () => {
    expect(renderBio('Grew up on a **farm**.\n\nLoved *gardening*. [Record](https://example.org/a)')).toBe(
      '<p>Grew up on a <strong>farm</strong>.</p><p>Loved <em>gardening</em>. <a href="https://example.org/a" target="_blank" rel="noopener noreferrer">Record</a></p>',
    );
  });

  it('escapes HTML', () => {
    expect(renderBio('<script>alert(1)</script> & "quotes"')).toBe(
      '<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quotes&quot;</p>',
    );
  });

  it('only links http and https', () => {
    expect(renderBio('[x](javascript:alert(1))')).toBe('<p>[x](javascript:alert(1))</p>');
  });

  it('cannot break out of the link attribute', () => {
    expect(renderBio('[x](https://a.org/"onmouseover="alert(1))')).not.toContain('" onmouseover');
  });

  it('is empty for no bio', () => {
    expect(renderBio(null)).toBe('');
    expect(renderBio(' '.repeat(3))).toBe('');
  });
});
