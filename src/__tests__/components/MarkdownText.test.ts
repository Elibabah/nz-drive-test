import { parseBlocks, parseInline } from '../../components/MarkdownText';

describe('parseBlocks', () => {
  it('renders a plain-paragraph debrief as paragraphs', () => {
    const text = 'Great session today.\n\nYou handled the roundabout well.';
    expect(parseBlocks(text)).toEqual([
      { type: 'paragraph', text: 'Great session today.' },
      { type: 'paragraph', text: 'You handled the roundabout well.' },
    ]);
  });

  it('joins consecutive lines into one paragraph', () => {
    const text = 'First line\nsecond line';
    expect(parseBlocks(text)).toEqual([
      { type: 'paragraph', text: 'First line second line' },
    ]);
  });

  it('parses the markdown Sonnet actually emits: headings, bold, lists', () => {
    const text = [
      '## What went well',
      'You kept to the speed limit on **Great South Road**.',
      '',
      '### Areas to work on',
      '- At the stop sign you were still doing 15 km/h',
      '- Late indication before turning',
      '',
      '1. Practise full stops',
      '2. Indicate 3 seconds before turning',
    ].join('\n');

    expect(parseBlocks(text)).toEqual([
      { type: 'heading', text: 'What went well' },
      { type: 'paragraph', text: 'You kept to the speed limit on **Great South Road**.' },
      { type: 'heading', text: 'Areas to work on' },
      { type: 'bullet', text: 'At the stop sign you were still doing 15 km/h' },
      { type: 'bullet', text: 'Late indication before turning' },
      { type: 'numbered', marker: '1', text: 'Practise full stops' },
      { type: 'numbered', marker: '2', text: 'Indicate 3 seconds before turning' },
    ]);
  });

  it('handles bullet variants and parenthesis-numbered lists', () => {
    expect(parseBlocks('* one\n• two\n3) three')).toEqual([
      { type: 'bullet', text: 'one' },
      { type: 'bullet', text: 'two' },
      { type: 'numbered', marker: '3', text: 'three' },
    ]);
  });

  it('returns nothing for empty input', () => {
    expect(parseBlocks('')).toEqual([]);
    expect(parseBlocks('\n\n')).toEqual([]);
  });
});

describe('parseInline', () => {
  it('leaves plain text as a single segment', () => {
    expect(parseInline('no markup here')).toEqual([{ text: 'no markup here' }]);
  });

  it('extracts bold segments', () => {
    expect(parseInline('slow down at **stop signs** next time')).toEqual([
      { text: 'slow down at ' },
      { text: 'stop signs', bold: true },
      { text: ' next time' },
    ]);
  });

  it('extracts italic segments with * and _', () => {
    expect(parseInline('a *b* and _c_')).toEqual([
      { text: 'a ' },
      { text: 'b', italic: true },
      { text: ' and ' },
      { text: 'c', italic: true },
    ]);
  });

  it('does not treat multiplication-style asterisks spanning newlines as italics', () => {
    expect(parseInline('5 * 3\n2 * 4')).toEqual([{ text: '5 * 3\n2 * 4' }]);
  });
});
