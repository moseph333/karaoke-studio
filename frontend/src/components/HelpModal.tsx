/**
 * Help & Usage Guide Modal Component
 *
 * In-app help with two tabs: a keyboard shortcut reference grouped by area (with the
 * typing/modal isolation note) and the five-stage studio workflow guide.
 */

import React, { useState, useEffect } from 'react';
import {
  HelpCircle,
  Keyboard,
  BookOpen,
  Sparkles,
  Music,
  Clock,
  Sliders,
  Download,
  Info,
  Check,
} from 'lucide-react';
import { Dialog, DialogFooter, DialogHeader } from './ui/Dialog';
import { Button } from './ui/Button';
import { Switch } from './ui/Switch';
import { Tabs } from './ui/Tabs';
import { modKeyLabel } from '../utils/platform';
import { characterShortcutsEnabled, setCharacterShortcutsEnabled } from '../utils/shortcutPrefs';

export interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'shortcuts' | 'guide';
}

interface ShortcutItem {
  /** Keys in order; "+" and "/" render as separators and "Mod" as ⌘ or Ctrl. */
  keys: string[];
  label: string;
  description: string;
  scope: string;
}

interface ShortcutGroup {
  title: string;
  items: ShortcutItem[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Playback',
    items: [
      {
        keys: ['Space'],
        label: 'Play / Pause',
        description: 'Play / pause master playback in the studio',
        scope: 'Studio Workspace',
      },
      {
        keys: ['← / →'],
        label: 'Seek ±5 Seconds',
        description: 'Seek backward / forward 5s along playback timeline',
        scope: 'Studio Workspace',
      },
      {
        keys: ['Shift', '+', '←', '/', '→'],
        label: 'Fine Seek ±1 Second',
        description: 'Step backward / forward 1s for precise timing work',
        scope: 'Studio Workspace',
      },
      {
        keys: ['Alt', '+', '←', '/', '→'],
        label: 'Jump ±15 Seconds',
        description: 'Skip backward / forward 15s through long intros and solos',
        scope: 'Studio Workspace',
      },
      {
        keys: ['⏮', '⏯', '⏭'],
        label: 'Media Keys',
        description:
          'Play / pause and step through lyric lines from keyboard media keys, headsets or the lock screen',
        scope: 'System',
      },
      {
        keys: ['M'],
        label: 'Mute / Unmute',
        description: 'Toggle master mute / unmute audio playback',
        scope: 'Studio Workspace',
      },
    ],
  },
  {
    title: 'Lyrics',
    items: [
      {
        keys: ['[', '/', ']'],
        label: 'Previous / Next Line',
        description: 'Jump playback to the start of the previous or next lyric line',
        scope: 'Studio Workspace',
      },
      {
        keys: ['R'],
        label: 'Replay Line',
        description: 'Restart the current lyric line from its first word',
        scope: 'Studio Workspace',
      },
      {
        keys: ['T'],
        label: 'Tap-to-Sync Stamp',
        description: 'Stamp active line or word timestamp in real time when Tap-to-Sync is enabled',
        scope: 'Tap-to-Sync Mode',
      },
      {
        keys: ['Mod', '+', 'Z', '/', 'Mod', '+', 'Y'],
        label: 'Undo / Redo Edits',
        description: 'Step backward or forward through up to 50 lyric or chord edits',
        scope: 'Timeline Editor',
      },
    ],
  },
  {
    title: 'Stage',
    items: [
      {
        keys: ['F'],
        label: 'Fullscreen Stage',
        description: 'Toggle Fullscreen TV Stage Mode with auto-hiding floating controls',
        scope: 'Studio Workspace',
      },
      {
        keys: ['V'],
        label: 'Beat Visualizer',
        description: 'Toggle beat-reactive audio visualizer on / off in Studio and TV Stage Mode',
        scope: 'Studio Workspace',
      },
      {
        keys: ['C'],
        label: 'Toggle Chord Bar',
        description: 'Toggle real-time harmonic chord progression bar in Studio and TV Stage Mode',
        scope: 'Studio Workspace',
      },
    ],
  },
  {
    title: 'General',
    items: [
      {
        keys: ['Mod', '+', 'K'],
        label: 'Command Palette',
        description: 'Search every command, song and lyric line from anywhere',
        scope: 'Global',
      },
      {
        keys: ['?'],
        label: 'Toggle Help Modal',
        description: 'Toggle this Help & Usage Guide modal from anywhere',
        scope: 'Global',
      },
      {
        keys: ['Tab', '/', 'Shift', '+', 'Tab'],
        label: 'Focus Navigation',
        description: 'Navigate interactive controls and cycle focus inside active dialogs',
        scope: 'Global & Modals',
      },
      {
        keys: ['Escape'],
        label: 'Dismiss / Close',
        description: 'Close modal dialogs, tooltips, or discard dropdowns',
        scope: 'Modals & Tooltips',
      },
    ],
  },
];

const kbdCls =
  'inline-flex min-w-[24px] items-center justify-center rounded-theme-sm border border-theme-border-subtle bg-theme-surface-subtle px-1.5 py-0.5 font-mono text-xs font-semibold text-theme-highlight shadow-[inset_0_-1px_0_rgb(var(--theme-border-rgb))]';

const ShortcutKeys: React.FC<{ keys: string[] }> = ({ keys }) => (
  <span className="flex shrink-0 items-center gap-1">
    {keys.map((k, i) =>
      k === '+' || k === '/' ? (
        <span key={i} className="text-[11px] text-theme-text-muted">
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
  step: string;
  title: string;
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;
  badge: string;
  summary: string;
  features: string[];
}

const STAGES: GuideStage[] = [
  {
    step: 'Stage 1',
    title: '1. Audio Intake & Library',
    icon: Music,
    badge: 'Input',
    summary: 'Import songs via YouTube URL or local audio files (.mp3, .wav, .flac).',
    features: [
      'Enter custom metadata (Title, Artist, Creator Name) for clear tracking',
      'Optionally supply custom lyrics as plain text or pre-timed LRC format ([mm:ss.xx])',
      'Search, filter by status, and sort saved library projects across My Songs and Community tabs',
    ],
  },
  {
    step: 'Stage 2',
    title: '2. Stem Separation & Lyric Sync',
    icon: Sparkles,
    badge: 'AI Engine',
    summary: 'Automated vocal isolation, vocal range/key detection, and acoustic word alignment.',
    features: [
      'Demucs AI separates clean vocals from backing instrumental tracks and detects vocal range & key',
      'Synchronized lyrics are fetched automatically from LRCLIB or parsed from your LRC tags',
      'Hot-swap or re-import custom/LRCLIB lyrics anytime inside the studio without re-separating stems',
    ],
  },
  {
    step: 'Stage 3',
    title: '3. Timeline Editing',
    icon: Clock,
    badge: 'Editor',
    summary: 'Fine-tune line and word timings, assign duet parts, and use power tools.',
    features: [
      'Scrub interactive audio waveform and observe live word-by-word progressive karaoke sweeps',
      'Assign Duet / Multi-Singer roles (Singer 1, Singer 2, Both) per line or via bulk/auto-split',
      'Use Undo/Redo (Ctrl+Z / Ctrl+Y), Batch Timestamp Offset, and live Tap-to-Sync [T] beat stamping',
      'Edit line text inline, insert new lines above/below, or delete unwanted lyric lines',
      'Edit chord cues inline with 50-step Undo/Redo (Ctrl+Z / Ctrl+Y) and persistence',
    ],
  },
  {
    step: 'Stage 4',
    title: '4. Studio Mixing & Themes',
    icon: Sliders,
    badge: 'Mixer',
    summary: 'Customize playback mix, Smart Key shift, visualizer, TV Stage, and aspect ratio.',
    features: [
      'Pitch shift (-12 to +12 semitones), Smart Key Recommender, guide vocal (0%–50%), and speed (0.5x–1.5x)',
      'Toggle Live Chord Bar [C], Fullscreen TV Stage Mode [F], Beat-Reactive Visualizer [V], and >=4.0s gap countdowns',
      'Select preset visual themes or customize sung/unsung colors and lyric font scaling (0.75x–1.5x)',
      'Pick a background (cover art, drifting art, aurora, spectrum, plain) or upload an image/video, and switch between 16:9 Widescreen and 9:16 Shorts',
    ],
  },
  {
    step: 'Stage 5',
    title: '5. Export & Subtitles',
    icon: Download,
    badge: 'Output',
    summary: 'Instant audio stem & subtitle downloads and full 1080p60 video rendering.',
    features: [
      'Direct 1-click downloads for isolated instrumental WAV, vocals WAV, and mixed master audio',
      'Instant downloads: export standalone .lrc and .ass (with multi-singer duet styles & gap countdowns)',
      'Render 1080p60 MP4 videos (with optional beat visualizer) and generate YouTube metadata packages',
    ],
  },
];

export const HelpModal: React.FC<HelpModalProps> = ({
  isOpen,
  onClose,
  initialTab = 'shortcuts',
}) => {
  const [activeTab, setActiveTab] = useState<'shortcuts' | 'guide'>(initialTab);
  const [characterKeysOn, setCharacterKeysOn] = useState(characterShortcutsEnabled);

  const handleCharacterKeysChange = (on: boolean) => {
    setCharacterShortcutsEnabled(on);
    setCharacterKeysOn(on);
  };

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab || 'shortcuts');
    }
  }, [isOpen, initialTab]);

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
        title="Karaoke Studio Help & Usage Guide"
        titleId="help-modal-title"
        description="Keyboard shortcuts reference and studio workflow guide"
        descriptionId="help-modal-desc"
        icon={<HelpCircle className="h-5 w-5" />}
        onClose={onClose}
        closeLabel="Close help and usage guide"
      />

      <Tabs<'shortcuts' | 'guide'>
        ariaLabel="Help topics"
        value={activeTab}
        onChange={setActiveTab}
        variant="underline"
        getTabId={(id) => `tab-${id}`}
        className="mb-4 overflow-x-auto"
        tabClassName="shrink-0 whitespace-nowrap"
        items={[
          {
            id: 'shortcuts',
            label: 'Keyboard Shortcuts',
            icon: <Keyboard className="h-4 w-4" aria-hidden="true" />,
            controls: 'tabpanel-shortcuts',
          },
          {
            id: 'guide',
            label: 'Studio Usage Guide',
            icon: <BookOpen className="h-4 w-4" aria-hidden="true" />,
            controls: 'tabpanel-guide',
          },
        ]}
      />

      {activeTab === 'shortcuts' ? (
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
            className="rounded-theme-lg border border-theme-border-subtle bg-theme-surface-subtle p-3.5 sm:p-4"
          />

          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.title} className="space-y-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-theme-text-muted">
                {group.title}
              </h3>
              <ul
                aria-label={`${group.title} shortcuts`}
                className="divide-y divide-theme-border-subtle overflow-hidden rounded-theme-lg border border-theme-border-subtle bg-theme-bg/60"
              >
                {group.items.map((item) => (
                  <li
                    key={item.label}
                    className="flex flex-col justify-between gap-2 p-3 sm:flex-row sm:items-center"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <ShortcutKeys keys={item.keys} />
                      <div className="min-w-0">
                        <span className="block font-theme-heading text-sm font-semibold text-theme-text sm:truncate">
                          {item.label}
                        </span>
                        <span className="block text-xs text-theme-text-muted sm:truncate">
                          {item.description}
                        </span>
                      </div>
                    </div>
                    <span className="shrink-0 self-start rounded-theme-pill border border-theme-border-subtle bg-theme-surface-subtle px-2 py-0.5 text-[10px] font-medium text-theme-text-muted sm:self-center sm:text-[11px]">
                      {item.scope}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          <div className="flex items-start gap-3 rounded-theme-lg border border-theme-border-subtle bg-theme-surface-subtle p-3.5 text-xs sm:p-4">
            <Info className="mt-0.5 h-5 w-5 shrink-0 text-theme-highlight" aria-hidden="true" />
            <div className="space-y-1">
              <span className="block font-theme-heading font-semibold text-theme-text">
                Keyboard Shortcut Isolation
              </span>
              <p className="text-[11px] leading-relaxed text-theme-text-muted sm:text-xs">
                Single-key shortcuts (<kbd className={kbdCls}>Space</kbd>,{' '}
                <kbd className={kbdCls}>←</kbd>/<kbd className={kbdCls}>→</kbd>,{' '}
                <kbd className={kbdCls}>M</kbd>, <kbd className={kbdCls}>C</kbd>,{' '}
                <kbd className={kbdCls}>?</kbd>) are automatically disabled while typing in text
                inputs, textareas, search boxes, or dropdowns, and when any modal dialog is active.
                They never interfere with typing lyrics or editing track details.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div
          role="tabpanel"
          id="tabpanel-guide"
          aria-labelledby="tab-guide"
          tabIndex={0}
          className="space-y-3 focus:outline-none"
        >
          {STAGES.map((stg) => {
            const IconComponent = stg.icon;
            return (
              <div
                key={stg.step}
                className="space-y-2.5 rounded-theme-lg border border-theme-border-subtle bg-theme-bg/60 p-3.5 sm:p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <div className="shrink-0 rounded-theme-md bg-theme-accent/15 p-2 text-theme-highlight">
                      <IconComponent className="h-4 w-4" aria-hidden="true" />
                    </div>
                    <h3 className="truncate font-theme-heading text-sm font-bold text-theme-text">
                      {stg.title}
                    </h3>
                  </div>
                  <span className="shrink-0 rounded-theme-pill border border-theme-accent/30 bg-theme-accent/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-theme-highlight">
                    {stg.badge}
                  </span>
                </div>
                <p className="text-xs text-theme-text">{stg.summary}</p>
                <ul className="space-y-1.5 border-t border-theme-border-subtle pt-2">
                  {stg.features.map((feat, idx) => (
                    <li
                      key={idx}
                      className="flex items-start gap-2 text-[11px] text-theme-text-muted sm:text-xs"
                    >
                      <Check
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-theme-highlight"
                        aria-hidden="true"
                      />
                      <span>{feat}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      <DialogFooter>
        <Button variant="secondary" fullWidth="mobile" onClick={onClose} className="min-w-[44px]">
          Got it, close
        </Button>
      </DialogFooter>
    </Dialog>
  );
};

export default HelpModal;
