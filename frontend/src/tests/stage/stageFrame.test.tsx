import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import sceneCases from '@shared/stage_scene_cases.json';
import { StageFrame } from '../../components/stage/StageFrame';
import { STAGE_LOOKS, getStageLook, type Aspect } from '../../theme/stageLooks';
import { planStage, sceneAt, type StageStyle } from '../../utils/stageScene';

const SONG = sceneCases.song as unknown as {
  lines: Array<{ text: string; start_time: number; words: Array<{ start_time: number }> }>;
  title: string;
  artist: string;
  duration: number;
  part_names: Record<string, string>;
};

function styleOf(lookId: string, aspect: Aspect = '16:9', more: Partial<StageStyle> = {}) {
  const look = getStageLook(lookId);
  const { sung, unsung, singer2, both } = look.palette;
  const style: StageStyle = {
    look,
    aspect,
    sung,
    unsung,
    singer2,
    both,
    scale: 1,
    syncMode: 'word',
    cues: true,
    partNames: SONG.part_names,
    ...more,
  };
  return style;
}

function show(lookId: string, time: number, aspect: Aspect = '16:9', onSeek = vi.fn()) {
  const style = styleOf(lookId, aspect);
  const plan = planStage(SONG.lines, SONG.duration, style, {
    title: SONG.title,
    artist: SONG.artist,
  });
  const view = render(
    <StageFrame
      look={style.look}
      aspect={aspect}
      scene={sceneAt(plan, time)}
      time={time}
      onSeek={onSeek}
    >
      <div data-testid="behind" />
    </StageFrame>
  );
  return { ...view, onSeek, plan };
}

const prop = (el: HTMLElement, name: string) => el.style.getPropertyValue(name);

describe('the stage as a frame of the video', () => {
  it.each(STAGE_LOOKS.map((look) => look.id))('draws %s in a frame of the video shape', (id) => {
    show(id, 13.4);
    const frame = screen.getByTestId('stage-frame');
    expect(frame).toHaveAttribute('data-look', id);
    expect(frame).toHaveAttribute('data-aspect', '16:9');
    expect(Number(prop(frame, '--ar'))).toBeCloseTo(16 / 9, 5);
    expect(screen.getByTestId('active-lyrics-line')).toBeInTheDocument();
    expect(within(screen.getByTestId('stage-picture')).getByTestId('behind')).toBeInTheDocument();
  });

  it('takes the shape of a 9:16 video too', () => {
    show('marquee', 13.4, '9:16');
    expect(Number(prop(screen.getByTestId('stage-frame'), '--ar'))).toBeCloseTo(9 / 16, 5);
  });

  it('places a row by custom properties in u, never by the box it is in', () => {
    show('ktv', 13.4);
    const row = screen.getByTestId('active-lyrics-line');
    const look = getStageLook('ktv').frames['16:9'];
    expect(Number(prop(row, '--x'))).toBe(look.rows?.[0].x);
    expect(Number(prop(row, '--size'))).toBe(look.lyric.size);
    // The row hangs one strut (1.5 em) above its baseline
    expect(Number(prop(row, '--y'))).toBeCloseTo(
      (look.rows?.[0].baseline ?? 0) - 1.5 * (look.lyric.size ?? 0),
      3
    );
    expect(row.querySelector('.ks-strut')).not.toBeNull();
  });

  it('fills the words that are sung and leaves the rest', () => {
    show('ktv', 13.4);
    const line = SONG.lines[0];
    const sungBy = line.words.filter((word) => word.start_time < 13.4).length;
    expect(screen.getByTestId('word-sung-0')).toHaveStyle({ width: '100.00%' });
    expect(screen.getByTestId('word-sung-0').style.clipPath).toBe('inset(0 0.00% 0 0)');
    const last = screen.getByTestId(`word-sung-${line.words.length - 1}`);
    expect(last).toHaveStyle({ width: '0.00%' });
    expect(last.style.clipPath).toBe('inset(0 100.00% 0 0)');
    expect(sungBy).toBeGreaterThan(0);
    expect(screen.getByTestId('word-sung-0')).toHaveAttribute('aria-hidden', 'true');
  });

  it('names each word of the line being sung as the lyrics write it and seeks to it', () => {
    const { onSeek } = show('marquee', 13.4);
    // Marquee draws capitals; the name keeps the lyric's own spelling
    const word = screen.getByRole('button', {
      name: 'Jump playback to word Paper at 12.00 seconds',
    });
    expect(word).toHaveTextContent('PAPER');
    fireEvent.click(word);
    expect(onSeek).toHaveBeenCalledWith(12);
  });

  it('gives a line that is not being sung one control that seeks to its start', () => {
    const { onSeek } = show('marquee', 13.4);
    const next = screen.getByRole('button', {
      name: `Jump playback to line at ${SONG.lines[1].start_time.toFixed(2)} seconds`,
    });
    expect(next).toHaveTextContent('Drifting where the river bends');
    fireEvent.click(next);
    expect(onSeek).toHaveBeenCalledWith(SONG.lines[1].start_time);
  });

  it('keeps the stable word ids on the line a singer follows when two lines show', () => {
    // KTV at 15.6: the first line is in its lead-out, the second is showing before it starts
    show('ktv', 15.6);
    const rows = screen.getAllByTestId(/^(active-lyrics-line|stage-line)$/);
    expect(rows.map((row) => row.getAttribute('data-line'))).toEqual(['0', '1']);
    expect(screen.getByTestId('active-lyrics-line')).toHaveAttribute('data-line', '0');
    expect(screen.getByTestId('word-sung-0')).toBeInTheDocument();
    expect(screen.getByTestId('word-sung-1-0')).toBeInTheDocument();
  });

  it('draws an ad-lib smaller and fainter, italic only where the look has an italic', () => {
    show('songbook', 33.4);
    const adlib = screen
      .getAllByRole('button')
      .find((button) => button.getAttribute('data-adlib') === 'true') as HTMLElement;
    expect(adlib).toHaveTextContent('(hold');
    expect(adlib).toHaveStyle({ fontSize: '0.8em', opacity: '0.75', fontStyle: 'italic' });
    show('ktv', 33.4);
    const plain = screen
      .getAllByRole('button')
      .filter((button) => button.getAttribute('data-adlib') === 'true')
      .pop() as HTMLElement;
    expect(plain.style.fontStyle).toBe('');
  });

  it('shows the part name where the singer changes, and the romaji under its line', () => {
    show('ktv', 21.2);
    expect(screen.getByTestId('stage-part-name')).toHaveTextContent('Theo');
    show('ktv', 37.6);
    const romaji = screen.getByTestId('stage-romaji');
    expect(romaji).toHaveTextContent('yoru no basu ni notte');
    expect(romaji).toHaveAttribute('lang', 'ja-Latn');
  });

  it('shows the title card, the count-in, the break marker and the end card in turn', () => {
    show('marquee', 3);
    expect(screen.getByTestId('stage-title-card')).toHaveTextContent('PAPER LANTERNS');
    expect(screen.getByTestId('stage-title-card-artist')).toHaveTextContent('THE NIGHT BUSES');
    show('marquee', 10.4);
    expect(screen.getByTestId('stage-count-in')).toHaveTextContent('2');
    expect(screen.getByTestId('stage-count-in')).toHaveAttribute('aria-hidden', 'true');
    show('marquee', 47);
    expect(screen.getByTestId('stage-break-marker')).toHaveTextContent('9');
    show('marquee', 72);
    expect(screen.getByTestId('stage-end-card-title')).toHaveTextContent('PAPER LANTERNS');
  });

  it('draws the progress line as a share of the frame width', () => {
    show('marquee', 38);
    const bar = screen.getByTestId('stage-progress');
    expect(Number(prop(bar, '--w'))).toBeCloseTo(((100 * 16) / 9) * (38 / 76), 2);
    expect(bar).toHaveAttribute('aria-hidden', 'true');
  });

  it('counts in with dots in KTV and marks the reading line in Prompter', () => {
    show('ktv', 10.4);
    expect(screen.getAllByTestId('stage-countin')).toHaveLength(2);
    show('prompter', 13.4);
    expect(screen.getByTestId('stage-caret')).toHaveAttribute('data-shape', 'triangle');
  });

  it('frames the picture in Cinema and dims it under a card', () => {
    show('cinema', 3);
    const picture = screen.getByTestId('stage-picture');
    expect(picture.style.top).toBe('12.8%');
    expect(Number.parseFloat(picture.style.height)).toBeCloseTo(74.4, 3);
    expect(Number(prop(screen.getByTestId('stage-scrim'), '--alpha'))).toBeCloseTo(0.62, 2);
    show('marquee', 3);
    expect(['0', '0px']).toContain(screen.getAllByTestId('stage-picture').pop()?.style.inset);
  });

  it('draws KTV with its outline and soft shadow, and the flat looks without', () => {
    show('ktv', 13.4);
    const outlined = screen.getByTestId('active-lyrics-line');
    expect(outlined.style.filter).toContain('drop-shadow(');
    expect(outlined.style.paintOrder).toBe('stroke fill');
    show('songbook', 13.4);
    const flat = screen.getAllByTestId('active-lyrics-line').pop() as HTMLElement;
    expect(flat.style.filter).toBe('');
  });

  it('draws each row in its look’s typeface, weight and style', () => {
    show('cinema', 13.4);
    const row = screen.getByTestId('active-lyrics-line');
    expect(row.style.fontFamily).toContain('Jost');
    expect(row.style.fontWeight).toBe('500');
  });
});

describe('what the stage keeps to the video’s measure', () => {
  it('draws the visualizer in the band the video does: the bottom 240 px of the picture', async () => {
    const { LyricDisplay } = await import('../../components/LyricDisplay');
    const lines = [{ id: 1, text: 'One line', start_time: 1, end_time: 3, words: [] }];
    const band = (lookId: string, aspectRatio: string) => {
      const view = render(
        <LyricDisplay
          lines={lines}
          currentTime={1.5}
          selectedTheme={getStageLook(lookId)}
          aspectRatio={aspectRatio}
          showVisualizer
        />
      );
      const height = parseFloat(screen.getByTestId('stage-visualizer-band').style.height);
      // Behind the lyrics: inside the picture, never in the canvas the words are drawn on
      expect(screen.getByTestId('stage-picture')).toContainElement(
        screen.getByTestId('stage-visualizer-band')
      );
      view.unmount();
      return height;
    };
    // 240 of 1080 px, 240 of 1920 px, and 240 px of Cinema's 2.39:1 picture
    expect(band('marquee', '16:9')).toBeCloseTo((240 / 1080) * 100, 1);
    expect(band('marquee', '9:16')).toBeCloseTo((240 / 1920) * 100, 1);
    const picture = getStageLook('cinema').frames['16:9'].picture!;
    expect(band('cinema', '16:9')).toBeCloseTo((240 / (picture.h * 10.8)) * 100, 1);
  });

  it('shows a look’s sample as a strip of the frame with the words in view', async () => {
    const { LookSample } = await import('../../components/stage/LookSample');
    for (const look of STAGE_LOOKS) {
      for (const aspect of ['16:9', '9:16'] as Aspect[]) {
        const view = render(<LookSample look={look} aspect={aspect} />);
        const sample = view.container.querySelector<HTMLElement>(
          `[data-look-sample="${look.id}"]`
        )!;
        expect(sample.style.aspectRatio).toBe('3.2');
        const frame = sample.firstElementChild as HTMLElement;
        const frameHeight = aspect === '9:16' ? (100 * 16) / 9 : 100;
        const bandHeight = (aspect === '9:16' ? 100 : (100 * 16) / 9) / 3.2;
        // The strip never shows anything outside the frame
        const top = (-parseFloat(frame.style.top) / 100) * bandHeight;
        expect(top).toBeGreaterThanOrEqual(0);
        expect(top + bandHeight).toBeLessThanOrEqual(frameHeight + 0.01);
        // ... and the line being sung is inside it
        const row = sample.querySelector<HTMLElement>('.ks-row[data-role="lyric"]');
        if (row) {
          // A row hangs from a strut of one and a half ems: its baseline is that far under --y
          const baseline =
            parseFloat(row.style.getPropertyValue('--y')) +
            1.5 * parseFloat(row.style.getPropertyValue('--size'));
          expect(baseline).toBeGreaterThan(top);
          expect(baseline).toBeLessThan(top + bandHeight);
        }
        // Nothing in a sample can be pressed or found as the stage
        expect(sample.querySelector('button')).toBeNull();
        expect(sample.querySelector('[data-testid]')).toBeNull();
        view.unmount();
      }
    }
  });
});
