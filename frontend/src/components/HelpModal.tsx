/**
 * Help & Usage Guide Modal Component
 *
 * In-app help with four tabs: a keyboard shortcut reference grouped by area (with the
 * typing/modal isolation note), "What you can do" (`help/HelpFeatures`: the features that are
 * easy to miss, each with a button that points at its control), the studio usage guide (the
 * first-song steps, what to expect and the workflow stage by stage) and "Fix a problem"
 * (`utils/troubleshooting`), whose buttons go to the tool that fixes each problem while a
 * song is open.
 */

import React, { useState, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { Dialog, DialogFooter, DialogHeader } from './ui/Dialog';
import { Button } from './ui/Button';
import { Switch } from './ui/Switch';
import { Tabs } from './ui/Tabs';
import { modKeyLabel } from '../utils/platform';
import { characterShortcutsEnabled, setCharacterShortcutsEnabled } from '../utils/shortcutPrefs';
import { useServerVersion } from '../hooks/useServerVersion';
import { GUIDE_ACTION_LABELS, type GuideAction, type HelpTab } from '../utils/guideActions';
import { FIRST_SONG_STEPS, PROBLEMS } from '../utils/troubleshooting';
import type { GuideScreen } from '../utils/guideStops';
import { HelpFeatures } from './help/HelpFeatures';
import { cn } from '../utils/cn';
import { focusRing } from './ui/variants';

export interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: HelpTab;
  /** A finished song is open, so the fixes can take the user to its tools. */
  songOpen?: boolean;
  /** Carries out a fix's action; the caller closes this dialog first. */
  onAction?: (action: GuideAction) => void;
  /** Brings back the studio's first-song card; left out while it is showing. */
  onShowFirstSongSteps?: () => void;
  /** The screen behind the dialog, when the guide can point at its controls. */
  guideScreen?: GuideScreen | null;
  /** Points at a feature's control; the caller closes this dialog first. */
  onShowFeature?: (featureId: string) => void;
  /** Starts the tour of the screen behind the dialog; the caller closes this dialog first. */
  onStartTour?: () => void;
}

interface ShortcutItem {
  /** Keys in order; "+" and "/" render as separators and "Mod" as ⌘ or Ctrl. */
  keys: string[];
  label: string;
  /** Left out when the label says it all. */
  description?: string;
}

interface ShortcutGroup {
  title: string;
  items: ShortcutItem[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Playback',
    items: [
      { keys: ['Space'], label: 'Play or pause' },
      { keys: ['← / →'], label: 'Back or forward 5 seconds' },
      { keys: ['Shift', '+', '←', '/', '→'], label: 'Back or forward 1 second' },
      { keys: ['Alt', '+', '←', '/', '→'], label: 'Back or forward 15 seconds' },
      {
        keys: ['⏮', '⏯', '⏭'],
        label: 'Media keys',
        description:
          'Play, pause and move between lines from a keyboard, a headset or the lock screen',
      },
      { keys: ['M'], label: 'Mute or unmute' },
    ],
  },
  {
    title: 'Lyrics',
    items: [
      { keys: ['[', '/', ']'], label: 'Previous or next line' },
      { keys: ['R'], label: 'Replay the current line' },
      {
        keys: ['T'],
        label: 'Stamp the time',
        description: 'While Tap sync is on: sets the current line or word to this moment',
      },
      {
        keys: ['Mod', '+', 'Z', '/', 'Mod', '+', 'Y'],
        label: 'Undo or redo',
        description: 'Up to 50 lyric or chord edits',
      },
    ],
  },
  {
    title: 'Stage',
    items: [
      { keys: ['F'], label: 'Full screen stage' },
      { keys: ['V'], label: 'Visualizer on or off' },
      { keys: ['C'], label: 'Chords on or off' },
    ],
  },
  {
    title: 'General',
    items: [
      {
        keys: ['Mod', '+', 'K'],
        label: 'Command palette',
        description: 'Search every command, song and lyric line',
      },
      { keys: ['?'], label: 'Open or close Help' },
      { keys: ['Tab', '/', 'Shift', '+', 'Tab'], label: 'Move between controls' },
      { keys: ['Escape'], label: 'Close a dialog, menu or tooltip' },
    ],
  },
];

const kbdCls =
  'inline-flex min-w-[24px] items-center justify-center border border-theme-text-muted px-1.5 py-0.5 font-mono text-xs font-semibold text-theme-text';

const ShortcutKeys: React.FC<{ keys: string[] }> = ({ keys }) => (
  <span className="flex shrink-0 items-center gap-1">
    {keys.map((k, i) =>
      k === '+' || k === '/' ? (
        <span key={i} className="text-xs text-theme-text-muted">
          {k}
        </span>
      ) : (
        <kbd key={i} className={kbdCls}>
          {k === 'Mod' ? modKeyLabel() : k}
        </kbd>
      )
    )}
  </span>
);

interface GuideStage {
  title: string;
  summary: string;
  features: string[];
}

const STAGES: GuideStage[] = [
  {
    title: '1. Add a song',
    summary: 'Search for it by name, paste a link, or upload an audio file.',
    features: [
      'Links work from YouTube, SoundCloud, Bandcamp, Vimeo and the Internet Archive. A Spotify, Apple Music, TIDAL or Deezer link is matched to the same recording on YouTube.',
      'A link or file that holds a whole album lists its songs, so you can pick the ones you want.',
      'Under Advanced options you can paste your own lyrics, plain or with LRC timestamps, and choose how carefully the vocals are removed.',
      'Your songs are in the setlist under the search box. Community lists what others on this server have made.',
    ],
  },
  {
    title: '2. Wait while it is made',
    summary: 'The studio removes the vocals, finds the lyrics and times every word.',
    features: [
      'Most songs take a few minutes. You can leave the page; the song will be in your setlist.',
      'Choose Fast, Balanced or Best: the slower settings remove the vocals more cleanly. You can re-make the stems later with Improve in Audio mix.',
      'It is automatic, so a lyric or a line can come out wrong. The song check-up lists what to look at.',
    ],
  },
  {
    title: '3. Fix lyrics and timing',
    summary: 'The timeline lists every line. The one being sung is lit.',
    features: [
      'Click a line to jump to it. Double-click its words to edit them.',
      'Nudge a line earlier or later, or open it to set each word.',
      'Needs review shows only the lines the studio is unsure of. A line’s menu can re-time it; Re-import can re-time them all.',
      'Offset moves every line at once. Tap sync lets you set the times by tapping along.',
      'Duet parts gives lines to Singer 1, Singer 2 or Both.',
      'Undo and redo cover the last 50 edits.',
    ],
  },
  {
    title: '4. Set the key and the look',
    summary: 'Audio mix changes what you hear. Stage look changes what you see and export.',
    features: [
      'Move the key up or down 12 semitones, or let the studio suggest a key for your voice. The tempo stays the same.',
      'Turn the guide vocal up to sing along with the original, and slow the song down to practise.',
      'Pick a stage preset, its colours, the lyric size and a background, in 16:9 or 9:16.',
      'The stage can show chords and a visualizer, and goes full screen for a TV.',
    ],
  },
  {
    title: '5. Export',
    summary: 'A 1080p60 video, subtitle files and the separated audio.',
    features: [
      'Render makes an MP4 of the song as it is now. You can keep working while it renders.',
      'After a render, Upload to YouTube gives you the title, description and tags to paste.',
      'Subtitles (.lrc and .ass), the stems and a chord sheet download straight away.',
    ],
  },
  {
    title: '6. Install on your phone',
    summary: 'Add the studio to your home screen so it opens full screen, like an app.',
    features: [
      'Android and Chrome: tap Install in the top bar on the home screen, or pick Install app from the browser menu or the command palette.',
      'iPhone and iPad: in Safari, tap Share, then Add to Home Screen, then Add.',
      'Android: share a YouTube video to Karaoke Studio from the YouTube app to open it with the link filled in.',
      'The installed app shows a reconnect screen while your server is down or restarting, and Back returns from a song to the home screen.',
    ],
  },
];

export const HelpModal: React.FC<HelpModalProps> = ({
  isOpen,
  onClose,
  initialTab = 'shortcuts',
  songOpen = false,
  onAction,
  onShowFirstSongSteps,
  guideScreen = null,
  onShowFeature,
  onStartTour,
}) => {
  const [activeTab, setActiveTab] = useState<HelpTab>(initialTab);
  const canAct = songOpen && Boolean(onAction);
  const [characterKeysOn, setCharacterKeysOn] = useState(characterShortcutsEnabled);
  const serverVersion = useServerVersion(isOpen);

  const handleCharacterKeysChange = (on: boolean) => {
    setCharacterShortcutsEnabled(on);
    setCharacterKeysOn(on);
  };

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab || 'shortcuts');
    }
  }, [isOpen, initialTab]);

  // The tab list scrolls sideways on phones: keep the selected tab in view, since guidance
  // can open the dialog on the last one
  useEffect(() => {
    if (!isOpen) return;
    document
      .getElementById(`tab-${activeTab}`)
      ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [isOpen, activeTab]);

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      titleId="help-modal-title"
      descriptionId="help-modal-desc"
      size="3xl"
      dataModal="help"
      showDragHandle
    >
      <DialogHeader
        title="Help"
        titleId="help-modal-title"
        description="Keyboard shortcuts, what you can do, how the studio works and fixes for common problems"
        descriptionId="help-modal-desc"
        onClose={onClose}
        closeLabel="Close help"
      />

      <Tabs<HelpTab>
        ariaLabel="Help topics"
        value={activeTab}
        onChange={setActiveTab}
        getTabId={(id) => `tab-${id}`}
        className="mb-4 overflow-x-auto"
        tabClassName="shrink-0 whitespace-nowrap"
        items={[
          {
            id: 'shortcuts',
            label: 'Keyboard shortcuts',
            controls: 'tabpanel-shortcuts',
          },
          {
            id: 'features',
            label: 'What you can do',
            controls: 'tabpanel-features',
          },
          {
            id: 'guide',
            label: 'Studio usage guide',
            controls: 'tabpanel-guide',
          },
          {
            id: 'fix',
            label: 'Fix a problem',
            controls: 'tabpanel-fix',
          },
        ]}
      />

      {activeTab === 'shortcuts' && (
        <div
          role="tabpanel"
          id="tabpanel-shortcuts"
          aria-labelledby="tab-shortcuts"
          tabIndex={0}
          className="space-y-5 focus:outline-none"
        >
          <Switch
            checked={characterKeysOn}
            onChange={handleCharacterKeysChange}
            label="Letter and symbol shortcuts"
            description="M, V, C, F, T, R, [, ] and ?. Turn them off if speech input or a stray keypress sets them off; Space and the arrow keys keep working."
            testId="help-character-shortcuts-switch"
          />

          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.title}>
              <h3 className="ks-display border-b-2 border-theme-border pb-1 text-[24px] text-theme-text">
                {group.title}
              </h3>
              <ul
                aria-label={`${group.title} shortcuts`}
                className="divide-y divide-theme-border-subtle"
              >
                {group.items.map((item) => (
                  <li key={item.label} className="py-2">
                    <div className="flex min-w-0 items-center gap-4">
                      <ShortcutKeys keys={item.keys} />
                      <div className="min-w-0">
                        <span className="block text-base text-theme-text">{item.label}</span>
                        {item.description && (
                          <span className="block text-sm text-theme-text-muted">
                            {item.description}
                          </span>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          <div>
            <div className="space-y-1">
              <span className="block text-sm font-semibold text-theme-text">
                When shortcuts are off
              </span>
              <p className="text-sm leading-relaxed text-theme-text-muted">
                Single-key shortcuts (<kbd className={kbdCls}>Space</kbd>,{' '}
                <kbd className={kbdCls}>←</kbd> <kbd className={kbdCls}>→</kbd>,{' '}
                <kbd className={kbdCls}>M</kbd>, <kbd className={kbdCls}>C</kbd>,{' '}
                <kbd className={kbdCls}>?</kbd>) do nothing while you type in a field or while a
                dialog is open, so they never get in the way of typing lyrics.
              </p>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'guide' && (
        <div
          role="tabpanel"
          id="tabpanel-guide"
          aria-labelledby="tab-guide"
          tabIndex={0}
          className="space-y-5 focus:outline-none"
        >
          <section aria-labelledby="help-first-song-heading" className="space-y-2.5">
            <h3
              id="help-first-song-heading"
              className="ks-display border-b-2 border-theme-border pb-1 text-[24px] text-theme-text"
            >
              Your first song
            </h3>
            <ol className="space-y-1.5">
              {FIRST_SONG_STEPS.map((step, index) => (
                <li
                  key={step.title}
                  className="flex items-start gap-2 text-sm text-theme-text-muted"
                >
                  <span aria-hidden="true" className="tabular-nums font-semibold text-theme-text">
                    {index + 1}.
                  </span>
                  <span>
                    <strong className="font-semibold text-theme-text">{step.title}.</strong>{' '}
                    {step.text}
                  </span>
                </li>
              ))}
            </ol>
            <p className="text-sm text-theme-text-muted">
              <strong className="font-semibold text-theme-text">What to expect.</strong> Songs are
              made automatically. Most come out ready to sing; some need a lyric or a line&apos;s
              timing fixed, and the studio marks which. See the Fix a problem tab.
            </p>
            {songOpen && onShowFirstSongSteps && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  onShowFirstSongSteps();
                  onClose();
                }}
              >
                Show the first-song steps
              </Button>
            )}
          </section>
          {STAGES.map((stg) => {
            return (
              <div key={stg.title} className="space-y-2">
                <h3 className="ks-display border-b-2 border-theme-border pb-1 text-[24px] text-theme-text">
                  {stg.title}
                </h3>
                <p className="text-sm text-theme-text">{stg.summary}</p>
                <ul className="list-disc space-y-1 pl-5 marker:text-theme-text-muted">
                  {stg.features.map((feat, idx) => (
                    <li key={idx} className="text-sm text-theme-text-muted">
                      {feat}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      {activeTab === 'features' && (
        <div
          role="tabpanel"
          id="tabpanel-features"
          aria-labelledby="tab-features"
          tabIndex={0}
          className="focus:outline-none"
        >
          <HelpFeatures screen={guideScreen} onShow={onShowFeature} onStartTour={onStartTour} />
        </div>
      )}

      {activeTab === 'fix' && (
        <div
          role="tabpanel"
          id="tabpanel-fix"
          aria-labelledby="tab-fix"
          tabIndex={0}
          className="space-y-3 focus:outline-none"
        >
          <div>
            <div className="min-w-0 space-y-3">
              <p className="text-sm leading-relaxed text-theme-text-muted">
                Songs are made automatically, so a lyric, a line&apos;s timing or the vocal removal
                can come out wrong. Pick what you notice below.{' '}
                {canAct
                  ? 'The song check-up lists what the studio itself sees in this song.'
                  : 'Open a finished song and the fixes get buttons that take you to the right tool.'}
              </p>
              {canAct && (
                <Button size="sm" variant="primary" onClick={() => onAction?.('checkup')}>
                  {GUIDE_ACTION_LABELS.checkup}
                </Button>
              )}
            </div>
          </div>

          <ul aria-label="Common problems" className="border-t-2 border-theme-border">
            {PROBLEMS.map((problem) => (
              <li key={problem.id}>
                <details
                  data-problem={problem.id}
                  className="group border-b border-theme-border-subtle"
                >
                  <summary
                    className={cn(
                      'flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-3 py-2 text-base font-semibold text-theme-text [&::-webkit-details-marker]:hidden',
                      focusRing
                    )}
                  >
                    <span className="min-w-0 text-pretty">{problem.symptom}</span>
                    <ChevronDown
                      className="h-4 w-4 shrink-0 text-theme-text-muted transition-transform group-open:rotate-180"
                      aria-hidden="true"
                    />
                  </summary>
                  <div className="space-y-2.5 pb-4 text-sm">
                    {problem.why && (
                      <p className="leading-relaxed text-theme-text-muted">{problem.why}</p>
                    )}
                    <ol className="list-decimal space-y-1.5 pl-4 leading-relaxed text-theme-text marker:text-theme-text-muted">
                      {problem.steps.map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ol>
                    {canAct && problem.actions.length > 0 && (
                      <div className="flex flex-wrap gap-2 pt-0.5">
                        {problem.actions.map((action) => (
                          <Button
                            key={action}
                            size="sm"
                            variant="secondary"
                            aria-label={`${GUIDE_ACTION_LABELS[action]} (${problem.symptom})`}
                            onClick={() => onAction?.(action)}
                          >
                            {GUIDE_ACTION_LABELS[action]}
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>
                </details>
              </li>
            ))}
          </ul>
        </div>
      )}

      <DialogFooter>
        {serverVersion && (
          <p className="self-center text-sm text-theme-text-muted sm:mr-auto">
            Karaoke Studio {serverVersion}
          </p>
        )}
        <Button variant="secondary" fullWidth="mobile" onClick={onClose} className="min-w-[44px]">
          Close
        </Button>
      </DialogFooter>
    </Dialog>
  );
};

export default HelpModal;
