/**
 * The stage as a frame of the video: a box of the video's shape, centred in whatever space
 * it is given, in which every piece of text and every shape of a scene (utils/stageScene) is
 * placed in u, 1% of the frame's short side. The frame scales; nothing inside it reflows.
 *
 * Only effects the video's renderer (libass) can draw are used here: flat fills, an outline,
 * one soft shadow, opacity and straight moves. stageLibassGuard.test.ts keeps it so.
 */
import React from 'react';
import '../../stageFonts.css';
import { faceMetrics } from '../../theme/stageFontMetrics';
import { frameSize, type Aspect, type StageLook } from '../../theme/stageLooks';
import {
  wordFill,
  type SceneShape,
  type SceneText,
  type SceneWord,
  type StageScene,
} from '../../utils/stageScene';

/** A row hangs from a strut this many ems tall, which puts its baseline exactly where the
 * scene says whatever the typeface's own metrics are. */
const STRUT_EMS = 1.5;
/** Faces that cover what a look's own face lacks (CJK most of all), then any sans. */
const FALLBACK_FACES =
  "'Noto Sans CJK JP', 'Noto Sans JP', 'Hiragino Sans', 'Yu Gothic', sans-serif";

const u = (value: number): string => `calc(var(--u) * ${Number(value.toFixed(4))})`;

function faceStyle(face: string): React.CSSProperties {
  const metrics = faceMetrics(face);
  return {
    fontFamily: `'${metrics.css_family}', ${FALLBACK_FACES}`,
    fontWeight: metrics.css_weight,
    fontStyle: metrics.css_style,
  };
}

const ORIGIN = { left: 'left', center: 'center', right: 'right' } as const;
const SHIFT = { left: '0%', center: '-50%', right: '-100%' } as const;

export interface StageFrameProps {
  look: StageLook;
  aspect: Aspect;
  scene: StageScene;
  /** Song time in seconds, for the fill of the words. */
  time: number;
  onSeek?: (time: number) => void;
  /** What is drawn behind the lyrics (the background, the visualizer). */
  children?: React.ReactNode;
  /** False when what is behind the lyrics already has the look's picture frame in it (the
   * export's own cover-art still), so it fills the frame; anything else goes in the picture. */
  pictureOnly?: boolean;
  /** A picture of the look, not a stage: nothing in it can be pressed or found by a test id. */
  sample?: boolean;
}

/** Words sung in parentheses: smaller, a little see-through, italic where the look has one. */
function adlibStyle(look: StageLook): React.CSSProperties {
  return {
    fontSize: `${look.adlib.scale}em`,
    opacity: look.adlib.alpha,
    fontStyle: look.adlib.face ? 'italic' : undefined,
  };
}

interface WordProps {
  text: SceneText;
  word: SceneWord;
  last: boolean;
  time: number;
  /** Whether this is the line a singer follows, whose words carry the stable test ids. */
  active: boolean;
  look: StageLook;
  onSeek?: (time: number) => void;
}

const StageWord: React.FC<WordProps> = ({ text, word, last, time, active, look, onSeek }) => {
  const drawn = word.text + (word.space && !last ? ' ' : '');
  const filled = wordFill(text, word, time) * 100;
  const seekTo = word.start ?? text.start ?? 0;
  const id = active ? `word-sung-${word.index}` : `word-sung-${text.line}-${word.index}`;
  return (
    <button
      type="button"
      className="ks-word"
      data-adlib={word.adlib || undefined}
      onClick={() => onSeek?.(seekTo)}
      aria-label={`Jump playback to word ${word.written} at ${seekTo.toFixed(2)} seconds`}
      style={word.adlib ? adlibStyle(look) : undefined}
    >
      <span style={{ color: text.unsungColor }}>{drawn}</span>
      <span
        aria-hidden="true"
        data-testid={id}
        className="ks-word-sung"
        style={{
          width: `${filled.toFixed(2)}%`,
          clipPath: `inset(0 ${(100 - filled).toFixed(2)}% 0 0)`,
          color: text.sungColor,
        }}
      >
        {drawn}
      </span>
    </button>
  );
};

interface TextProps {
  look: StageLook;
  text: SceneText;
  time: number;
  active: boolean;
  onSeek?: (time: number) => void;
  sample?: boolean;
}

const TEST_IDS: Partial<Record<SceneText['role'], string>> = {
  lyric: 'stage-line',
  next: 'stage-line',
  sung: 'stage-line',
  part: 'stage-part-name',
  romaji: 'stage-romaji',
  title: 'stage-title-card',
  'title:artist': 'stage-title-card-artist',
  end: 'stage-end-card-title',
  'end:artist': 'stage-end-card-artist',
  countin: 'stage-count-in',
  break: 'stage-break-marker',
};

const StageTextView: React.FC<TextProps> = ({ look, text, time, active, onSeek, sample }) => {
  const outline = look.outline;
  const shadow = look.shadow;
  const isLine = text.role === 'lyric' || text.role === 'next' || text.role === 'sung';
  const base: React.CSSProperties = {
    ...faceStyle(text.face),
    letterSpacing: text.tracking ? `${text.tracking}em` : undefined,
    transformOrigin: ORIGIN[text.align],
    transform:
      `translateX(${SHIFT[text.align]})` + (text.condense < 1 ? ` scaleX(${text.condense})` : ''),
    ...(outline
      ? {
          WebkitTextStroke: `${u(outline.width * 2)} ${outline.color}`,
          paintOrder: 'stroke fill',
        }
      : {}),
    ...(shadow
      ? {
          filter: `drop-shadow(${u(shadow.offset)} ${u(shadow.offset)} ${u(shadow.blur * 2)} ${shadow.color}${Math.round(
            shadow.alpha * 255
          )
            .toString(16)
            .padStart(2, '0')})`,
        }
      : {}),
  };
  return (
    <>
      {text.rows.map((row, r) => {
        const style = {
          ...base,
          '--x': text.x,
          '--y': Number((row.baseline + text.dy - STRUT_EMS * text.size).toFixed(4)),
          '--size': text.size,
          '--alpha': Number(text.opacity.toFixed(4)),
        } as React.CSSProperties;
        const common = {
          className: 'ks-row',
          style,
          'data-role': text.role,
          'data-line': text.line ?? undefined,
          'data-row': r,
          'data-testid': sample
            ? undefined
            : r === 0 && text.role === 'lyric' && active
              ? 'active-lyrics-line'
              : TEST_IDS[text.role],
        };
        const strut = <span className="ks-strut" aria-hidden="true" />;
        if (sample) {
          // The words filled as far as the sample's moment, with nothing to press
          return (
            <div key={`${text.key}:${r}`} {...common}>
              {strut}
              <span className="ks-words">
                {row.words.map((word, i) => {
                  const piece = word.text + (word.space && i < row.words.length - 1 ? ' ' : '');
                  const filled = wordFill(text, word, time) * 100;
                  return (
                    <span
                      key={word.index}
                      className="ks-word"
                      style={word.adlib ? adlibStyle(look) : undefined}
                    >
                      <span style={{ color: text.unsungColor }}>{piece}</span>
                      <span
                        className="ks-word-sung"
                        style={{
                          width: `${filled.toFixed(2)}%`,
                          clipPath: `inset(0 ${(100 - filled).toFixed(2)}% 0 0)`,
                          color: text.sungColor,
                        }}
                      >
                        {piece}
                      </span>
                    </span>
                  );
                })}
              </span>
            </div>
          );
        }
        if (text.role === 'lyric') {
          return (
            <div key={`${text.key}:${r}`} {...common}>
              {strut}
              <span className="ks-words">
                {row.words.map((word, i) => (
                  <StageWord
                    key={word.index}
                    text={text}
                    word={word}
                    last={i === row.words.length - 1}
                    time={time}
                    active={active}
                    look={look}
                    onSeek={onSeek}
                  />
                ))}
              </span>
            </div>
          );
        }
        // Plain text, with a line's ad-libs still drawn smaller and fainter
        const drawn = row.words.map((word, i) => {
          const piece = word.text + (word.space && i < row.words.length - 1 ? ' ' : '');
          if (!word.adlib) return piece;
          return (
            <span key={word.index} data-adlib="true" style={adlibStyle(look)}>
              {piece}
            </span>
          );
        });
        if (isLine && text.start !== null) {
          const start = text.start;
          // One name per line: its first row is the control, the rest repeat it for a pointer
          return (
            <button
              key={`${text.key}:${r}`}
              type="button"
              {...common}
              className="ks-row ks-row-button"
              onClick={() => onSeek?.(start)}
              aria-label={`Jump playback to line at ${start.toFixed(2)} seconds`}
              aria-hidden={r > 0 || undefined}
              tabIndex={r > 0 ? -1 : undefined}
            >
              {strut}
              <span className="ks-words" style={{ color: text.unsungColor }}>
                {drawn}
              </span>
            </button>
          );
        }
        // The part taking over is said to someone who cannot see the stage
        const announces = text.role === 'part' && active;
        return (
          <div
            key={`${text.key}:${r}`}
            {...common}
            role={announces ? 'status' : undefined}
            aria-label={announces ? `Current Singer: ${text.rows[0].words[0].written}` : undefined}
            aria-hidden={text.role === 'countin' || text.role === 'break' || undefined}
            lang={text.role === 'romaji' ? 'ja-Latn' : undefined}
          >
            {strut}
            <span className="ks-words" style={{ color: text.unsungColor }}>
              {drawn}
            </span>
          </div>
        );
      })}
    </>
  );
};

const StageShapeView: React.FC<{ look: StageLook; shape: SceneShape; sample?: boolean }> = ({
  look,
  shape,
  sample,
}) => {
  const outline = shape.outlined ? look.outline : null;
  return (
    <div
      aria-hidden="true"
      className="ks-shape"
      data-role={shape.role}
      data-shape={shape.shape}
      data-testid={sample ? undefined : `stage-${shape.role}`}
      style={
        {
          '--x': shape.x,
          '--y': Number(shape.y.toFixed(4)),
          '--w': Number(shape.width.toFixed(4)),
          '--h': shape.height,
          '--alpha': Number(shape.opacity.toFixed(4)),
          backgroundColor: shape.color,
          boxShadow: outline ? `0 0 0 ${u(outline.width)} ${outline.color}` : undefined,
        } as React.CSSProperties
      }
    />
  );
};

/** The frame, with everything in `scene` placed in it. */
export const StageFrame: React.FC<StageFrameProps> = ({
  look,
  aspect,
  scene,
  time,
  onSeek,
  children,
  pictureOnly = true,
  sample = false,
}) => {
  const size = frameSize(aspect);
  const picture = pictureOnly ? look.frames[aspect].picture : undefined;
  return (
    <div className="ks-frame-fit">
      <div
        className="ks-frame"
        data-testid={sample ? undefined : 'stage-frame'}
        data-look={look.id}
        data-aspect={aspect}
        data-tone={look.tone}
        style={
          {
            '--ar': size.width / size.height,
            backgroundColor: look.palette.ground,
          } as React.CSSProperties
        }
      >
        {/* A look that frames its picture (Cinema) draws everything behind the lyrics in it */}
        <div
          className="ks-picture"
          data-testid={sample ? undefined : 'stage-picture'}
          style={
            picture
              ? {
                  left: `${(picture.x / size.width) * 100}%`,
                  top: `${(picture.y / size.height) * 100}%`,
                  width: `${(picture.w / size.width) * 100}%`,
                  height: `${(picture.h / size.height) * 100}%`,
                }
              : { inset: 0 }
          }
        >
          {children}
        </div>
        <div className="ks-canvas" data-testid={sample ? undefined : 'stage-canvas'}>
          {scene.shapes
            .filter((shape) => shape.role === 'scrim')
            .map((shape) => (
              <StageShapeView key={shape.key} look={look} shape={shape} sample={sample} />
            ))}
          {scene.texts.map((text) => (
            <StageTextView
              key={`${text.role}:${text.key}`}
              look={look}
              text={text}
              time={time}
              active={(text.role === 'lyric' || text.role === 'part') && text.line === scene.active}
              onSeek={onSeek}
              sample={sample}
            />
          ))}
          {scene.shapes
            .filter((shape) => shape.role !== 'scrim')
            .map((shape) => (
              <StageShapeView key={shape.key} look={look} shape={shape} sample={sample} />
            ))}
        </div>
      </div>
    </div>
  );
};
