/**
 * Help & Usage Guide Modal Component
 *
 * Provides an accessible in-app Help dialog containing:
 * 1. Global & studio keyboard shortcuts reference table with isolation callout
 * 2. 5-stage Studio Usage Guide (Intake, Stem Separation, Timeline, Mixer, Export)
 * Includes WAI-ARIA dialog semantics, focus trapping, and responsive geometry.
 */

import React, { useState, useEffect } from 'react';
import {
  X,
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
import { useFocusTrap } from '../hooks/useFocusTrap';

export interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'shortcuts' | 'guide';
}

interface ShortcutItem {
  keys: string[];
  label: string;
  description: string;
  scope: string;
}

const SHORTCUTS: ShortcutItem[] = [
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
    keys: ['M'],
    label: 'Mute / Unmute',
    description: 'Toggle master mute / unmute audio playback',
    scope: 'Studio Workspace',
  },
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
  {
    keys: ['T'],
    label: 'Tap-to-Sync Stamp',
    description: 'Stamp active line or word timestamp in real time when Tap-to-Sync is enabled',
    scope: 'Tap-to-Sync Mode',
  },
  {
    keys: ['Ctrl+Z / Ctrl+Y'],
    label: 'Undo / Redo Edits',
    description: 'Step backward or forward through up to 50 lyric timeline edits',
    scope: 'Timeline Editor',
  },
  {
    keys: ['?'],
    label: 'Toggle Help Modal',
    description: 'Toggle this Help & Usage Guide modal from anywhere',
    scope: 'Global',
  },
  {
    keys: ['Tab / Shift+Tab'],
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
];

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
      'Upload custom image/video backgrounds and switch between 16:9 Widescreen and 9:16 Shorts',
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

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab || 'shortcuts');
    }
  }, [isOpen, initialTab]);

  const modalRef = useFocusTrap<HTMLDivElement>({
    isOpen,
    onClose,
    escapeDeactivates: true,
  });

  if (!isOpen) return null;

  return (
    <div
      ref={modalRef}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-950/80 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="help-modal-title"
      aria-describedby="help-modal-desc"
      data-modal="help"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="relative w-full max-w-2xl sm:max-w-3xl max-h-[90vh] flex flex-col bg-theme-surface border border-theme-border rounded-t-2xl sm:rounded-theme-xl rounded-b-none sm:rounded-b-theme-xl shadow-theme-lg overflow-hidden">
        <div
          data-testid="bottom-sheet-drag-handle"
          className="w-10 h-1 bg-slate-700 rounded-full mx-auto my-2 sm:hidden shrink-0"
        />
        {/* Close Button (>=44px touch target) */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close help and usage guide"
          className="absolute top-3 right-3 sm:top-5 sm:right-5 min-w-[44px] min-h-[44px] p-2.5 rounded-theme-pill bg-theme-surface-subtle hover:bg-theme-surface-raised border border-theme-border-subtle text-theme-text-muted hover:text-theme-text transition-colors focus:outline-none focus:ring-2 focus:ring-theme-accent flex items-center justify-center z-10"
        >
          <X className="w-5 h-5" aria-hidden="true" />
        </button>

        {/* Modal Header */}
        <div className="p-4 sm:p-6 pb-3 sm:pb-4 border-b border-theme-border-subtle pr-14">
          <div className="flex items-center gap-3">
            <div className="p-2.5 sm:p-3 rounded-theme-lg bg-theme-accent/10 border border-theme-accent/20 text-theme-accent shrink-0">
              <HelpCircle className="w-6 h-6" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <h2
                id="help-modal-title"
                className="text-lg sm:text-xl font-bold text-theme-text font-theme-heading truncate"
              >
                Karaoke Studio Help & Usage Guide
              </h2>
              <p
                id="help-modal-desc"
                className="text-xs text-theme-text-muted font-theme-body mt-0.5 truncate"
              >
                Keyboard shortcuts reference and studio workflow guide
              </p>
            </div>
          </div>

          {/* Tab Navigation */}
          <div
            className="flex items-center gap-2 mt-4 border-b border-theme-border-subtle overflow-x-auto no-scrollbar"
            role="tablist"
            aria-label="Help topics"
          >
            <button
              type="button"
              role="tab"
              id="tab-shortcuts"
              aria-controls="tabpanel-shortcuts"
              aria-selected={activeTab === 'shortcuts'}
              onClick={() => setActiveTab('shortcuts')}
              className={`flex items-center gap-2 px-3 sm:px-4 py-2.5 border-b-2 text-xs sm:text-sm font-semibold transition-colors min-h-[44px] focus:outline-none focus:ring-2 focus:ring-theme-accent rounded-t-theme-sm whitespace-nowrap shrink-0 font-theme-heading ${
                activeTab === 'shortcuts'
                  ? 'border-theme-accent text-theme-accent bg-theme-accent/5'
                  : 'border-transparent text-theme-text-muted hover:text-theme-text hover:border-theme-border-subtle'
              }`}
            >
              <Keyboard className="w-4 h-4" aria-hidden="true" />
              <span>Keyboard Shortcuts</span>
            </button>

            <button
              type="button"
              role="tab"
              id="tab-guide"
              aria-controls="tabpanel-guide"
              aria-selected={activeTab === 'guide'}
              onClick={() => setActiveTab('guide')}
              className={`flex items-center gap-2 px-3 sm:px-4 py-2.5 border-b-2 text-xs sm:text-sm font-semibold transition-colors min-h-[44px] focus:outline-none focus:ring-2 focus:ring-theme-accent rounded-t-theme-sm whitespace-nowrap shrink-0 font-theme-heading ${
                activeTab === 'guide'
                  ? 'border-theme-accent text-theme-accent bg-theme-accent/5'
                  : 'border-transparent text-theme-text-muted hover:text-theme-text hover:border-theme-border-subtle'
              }`}
            >
              <BookOpen className="w-4 h-4" aria-hidden="true" />
              <span>Studio Usage Guide</span>
            </button>
          </div>
        </div>

        {/* Scrollable Modal Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-4">
          {activeTab === 'shortcuts' ? (
            <div
              role="tabpanel"
              id="tabpanel-shortcuts"
              aria-labelledby="tab-shortcuts"
              tabIndex={0}
              className="space-y-4 focus:outline-none"
            >
              {/* Keyboard Shortcuts List */}
              <div className="grid grid-cols-1 gap-2.5">
                {SHORTCUTS.map((item) => (
                  <div
                    key={item.label}
                    className="flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-theme-md bg-theme-bg border border-theme-border-subtle gap-2 hover:border-theme-border transition-colors shadow-theme-sm"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="flex items-center gap-1.5 shrink-0">
                        {item.keys.map((k) => (
                          <kbd
                            key={k}
                            className="px-2 py-1 rounded-theme-sm bg-theme-surface-subtle border border-theme-border-subtle text-theme-accent font-mono text-xs font-semibold shadow-inner"
                          >
                            {k}
                          </kbd>
                        ))}
                      </div>
                      <div className="min-w-0">
                        <span className="text-xs sm:text-sm font-semibold text-theme-text font-theme-heading block truncate">
                          {item.label}
                        </span>
                        <span className="text-[11px] sm:text-xs text-theme-text-muted font-theme-body block truncate">
                          {item.description}
                        </span>
                      </div>
                    </div>
                    <span className="self-start sm:self-center text-[10px] sm:text-[11px] font-medium px-2 py-0.5 rounded-theme-pill bg-theme-surface-subtle text-theme-text-muted border border-theme-border-subtle shrink-0">
                      {item.scope}
                    </span>
                  </div>
                ))}
              </div>

              {/* Isolation Callout Note */}
              <div className="p-3.5 sm:p-4 rounded-theme-md bg-theme-surface-subtle border border-theme-border-subtle text-theme-text text-xs flex items-start gap-3 shadow-theme-sm">
                <Info className="w-5 h-5 text-theme-accent shrink-0 mt-0.5" aria-hidden="true" />
                <div className="space-y-1">
                  <span className="font-semibold text-theme-text font-theme-heading block">
                    Keyboard Shortcut Isolation
                  </span>
                  <p className="text-theme-text-muted font-theme-body text-[11px] sm:text-xs leading-relaxed">
                    Single-key shortcuts (
                    <kbd className="px-1.5 py-0.5 bg-theme-bg rounded-theme-sm font-mono text-theme-accent border border-theme-border-subtle">
                      Space
                    </kbd>
                    ,{' '}
                    <kbd className="px-1.5 py-0.5 bg-theme-bg rounded-theme-sm font-mono text-theme-accent border border-theme-border-subtle">
                      ←
                    </kbd>
                    /
                    <kbd className="px-1.5 py-0.5 bg-theme-bg rounded-theme-sm font-mono text-theme-accent border border-theme-border-subtle">
                      →
                    </kbd>
                    ,{' '}
                    <kbd className="px-1.5 py-0.5 bg-theme-bg rounded-theme-sm font-mono text-theme-accent border border-theme-border-subtle">
                      M
                    </kbd>
                    ,{' '}
                    <kbd className="px-1.5 py-0.5 bg-theme-bg rounded-theme-sm font-mono text-theme-accent border border-theme-border-subtle">
                      C
                    </kbd>
                    ,{' '}
                    <kbd className="px-1.5 py-0.5 bg-theme-bg rounded-theme-sm font-mono text-theme-accent border border-theme-border-subtle">
                      ?
                    </kbd>
                    ) are automatically disabled while typing in text inputs, textareas, search
                    boxes, or dropdowns, and when any modal dialog is active. They never interfere
                    with typing lyrics or editing track details.
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
              className="space-y-4 focus:outline-none"
            >
              {STAGES.map((stg) => {
                const IconComponent = stg.icon;
                return (
                  <div
                    key={stg.step}
                    className="p-3.5 sm:p-4 rounded-theme-lg bg-theme-bg border border-theme-border-subtle space-y-2.5 hover:border-theme-border transition-colors shadow-theme-sm"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="p-2 rounded-theme-md bg-theme-accent/10 text-theme-accent border border-theme-accent/20 shrink-0">
                          <IconComponent className="w-4 h-4" aria-hidden="true" />
                        </div>
                        <h3 className="text-xs sm:text-sm font-bold text-theme-text font-theme-heading truncate">
                          {stg.title}
                        </h3>
                      </div>
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-theme-pill bg-theme-accent/15 text-theme-accent border border-theme-accent/30 uppercase tracking-wider shrink-0">
                        {stg.badge}
                      </span>
                    </div>

                    <p className="text-xs text-theme-text font-theme-body">{stg.summary}</p>

                    <ul className="space-y-1.5 pt-1 border-t border-theme-border-subtle">
                      {stg.features.map((feat, idx) => (
                        <li
                          key={idx}
                          className="flex items-start gap-2 text-[11px] sm:text-xs text-theme-text-muted font-theme-body"
                        >
                          <Check
                            className="w-3.5 h-3.5 text-theme-accent shrink-0 mt-0.5"
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
        </div>

        {/* Modal Footer with Dismiss Action */}
        <div className="p-3 sm:p-4 border-t border-theme-border-subtle bg-theme-surface-subtle/40 flex justify-end pb-[calc(1rem+env(safe-area-inset-bottom,0px))] sm:pb-4">
          <button
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto min-h-[44px] min-w-[44px] px-5 py-2.5 rounded-theme-md bg-theme-surface hover:bg-theme-surface-raised border border-theme-border-subtle text-theme-text text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-theme-accent flex items-center justify-center shadow-theme-sm"
          >
            Got it, close
          </button>
        </div>
      </div>
    </div>
  );
};

export default HelpModal;
