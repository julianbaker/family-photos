// family fork: renders a person's bio. Everything is escaped first; only paragraphs, line breaks,
// **bold**, *italic* and [links](http(s)://...) become HTML, so the output is safe for {@html}.

const escapeHtml = (text: string) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const renderInline = (escaped: string) =>
  escaped
    .replaceAll(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      (_, label: string, url: string) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`,
    )
    .replaceAll(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replaceAll(/\*([^*]+)\*/g, '<em>$1</em>');

export const renderBio = (bio: string | null | undefined): string => {
  if (!bio?.trim()) {
    return '';
  }
  return bio
    .trim()
    .split(/\n\s*\n/)
    .map((paragraph) => `<p>${renderInline(escapeHtml(paragraph.trim())).replaceAll('\n', '<br />')}</p>`)
    .join('');
};
