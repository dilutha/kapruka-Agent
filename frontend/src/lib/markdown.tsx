/**
 * Minimal markdown renderer for chat replies.
 *
 * Deliberately not a full markdown library — the model's replies only ever
 * use a small, predictable subset (bold, bullet/numbered lists, paragraphs),
 * and a small hand-rolled renderer avoids adding a dependency + its
 * transitive install surface for that subset.
 */
import { Fragment, type ReactNode } from 'react';

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={`${keyPrefix}-${i}`}>{part.slice(2, -2)}</strong>;
    }
    return <Fragment key={`${keyPrefix}-${i}`}>{part}</Fragment>;
  });
}

export function FormattedMessage({ content }: { content: string }) {
  const lines = content.split('\n');
  const blocks: ReactNode[] = [];
  let listItems: string[] = [];
  let listOrdered = false;

  const flushList = (key: string) => {
    if (listItems.length === 0) return;
    const ListTag = listOrdered ? 'ol' : 'ul';
    blocks.push(
      <ListTag key={key} style={{ margin: '4px 0', paddingLeft: 20 }}>
        {listItems.map((item, i) => (
          <li key={i} style={{ marginBottom: 2 }}>
            {renderInline(item, `${key}-${i}`)}
          </li>
        ))}
      </ListTag>,
    );
    listItems = [];
  };

  lines.forEach((line, idx) => {
    const bulletMatch = /^\s*[-*]\s+(.*)/.exec(line);
    const numberedMatch = /^\s*\d+[.)]\s+(.*)/.exec(line);

    if (bulletMatch) {
      if (listOrdered) flushList(`list-${idx}`);
      listOrdered = false;
      listItems.push(bulletMatch[1]);
      return;
    }
    if (numberedMatch) {
      if (!listOrdered) flushList(`list-${idx}`);
      listOrdered = true;
      listItems.push(numberedMatch[1]);
      return;
    }

    flushList(`list-${idx}`);
    if (line.trim().length === 0) {
      blocks.push(<div key={`sp-${idx}`} style={{ height: 6 }} />);
    } else {
      blocks.push(
        <p key={`p-${idx}`} style={{ margin: 0 }}>
          {renderInline(line, `p-${idx}`)}
        </p>,
      );
    }
  });
  flushList('list-end');

  return <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>{blocks}</div>;
}
