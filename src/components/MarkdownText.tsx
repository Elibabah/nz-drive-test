import React from 'react';
import { View, Text, StyleProp, TextStyle } from 'react-native';

// The debrief prompt asks Sonnet for plain paragraphs, but the model still
// slips in markdown — and sessions saved before the prompt was hardened have
// it stored verbatim. Render the subset it actually produces (headings, bold,
// italics, bullet/numbered lists) instead of showing raw ## and **.

export type MarkdownBlock =
  | { type: 'heading'; text: string }
  | { type: 'bullet'; text: string }
  | { type: 'numbered'; marker: string; text: string }
  | { type: 'paragraph'; text: string };

export function parseBlocks(markdown: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length > 0) {
      blocks.push({ type: 'paragraph', text: para.join(' ') });
      para = [];
    }
  };

  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (heading) {
      flush();
      blocks.push({ type: 'heading', text: heading[1] });
      continue;
    }
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    if (bullet) {
      flush();
      blocks.push({ type: 'bullet', text: bullet[1] });
      continue;
    }
    const numbered = line.match(/^(\d+)[.)]\s+(.*)$/);
    if (numbered) {
      flush();
      blocks.push({ type: 'numbered', marker: numbered[1], text: numbered[2] });
      continue;
    }
    para.push(line);
  }
  flush();
  return blocks;
}

export interface InlineSegment {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

export function parseInline(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*\n]+)\*|_([^_\n]+)_/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) segments.push({ text: text.slice(last, m.index) });
    if (m[1] !== undefined) segments.push({ text: m[1], bold: true });
    else segments.push({ text: m[2] ?? m[3], italic: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last) });
  return segments;
}

interface Props {
  children: string;
  textStyle?: StyleProp<TextStyle>;
  headingStyle?: StyleProp<TextStyle>;
}

function InlineText({ text, style }: { text: string; style?: StyleProp<TextStyle> }) {
  return (
    <Text style={style}>
      {parseInline(text).map((seg, i) => (
        <Text
          key={i}
          style={[
            seg.bold && { fontWeight: '700' },
            seg.italic && { fontStyle: 'italic' },
          ]}
        >
          {seg.text}
        </Text>
      ))}
    </Text>
  );
}

export default function MarkdownText({ children, textStyle, headingStyle }: Props) {
  return (
    <View style={{ gap: 10 }}>
      {parseBlocks(children).map((block, i) => {
        switch (block.type) {
          case 'heading':
            return <InlineText key={i} text={block.text} style={[textStyle, { fontWeight: '700' }, headingStyle]} />;
          case 'bullet':
          case 'numbered':
            return (
              <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
                <Text style={textStyle}>{block.type === 'bullet' ? '•' : `${block.marker}.`}</Text>
                <View style={{ flex: 1 }}>
                  <InlineText text={block.text} style={textStyle} />
                </View>
              </View>
            );
          default:
            return <InlineText key={i} text={block.text} style={textStyle} />;
        }
      })}
    </View>
  );
}
