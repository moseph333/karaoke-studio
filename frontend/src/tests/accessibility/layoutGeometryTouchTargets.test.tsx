import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import {
  BREAKPOINTS,
  setTestViewport,
  resetTestViewport,
  detectHorizontalOverflow,
  assertZeroHorizontalOverflow,
  assertTouchTargets,
  expectTouchTarget,
} from '../helpers/responsiveTestUtils';
import { AuthModal } from '../../components/AuthModal';
import { ExportModal } from '../../components/ExportModal';
import { TrackSearch } from '../../components/TrackSearch';
import { AudioControls } from '../../components/AudioControls';
import { LyricTimelineEditor } from '../../components/LyricTimelineEditor';
import { LyricLine, ProjectState } from '../../types';

describe('Milestone 3 Challenger 2: Adversarial Evaluation of Layout Geometry & Touch Targets', () => {
  const sampleLines: LyricLine[] = [
    {
      id: 1,
      text: 'Testing adversarial line length and touch targets',
      start_time: 1.0,
      end_time: 4.0,
      words: [
        { word: 'Testing', start_time: 1.0, end_time: 1.5 },
        { word: 'adversarial', start_time: 1.5, end_time: 2.5 },
        { word: 'line', start_time: 2.5, end_time: 3.0 },
      ],
    },
  ];

  const readyProject: ProjectState = {
    id: 'adversarial-project',
    status: 'ready',
    progress: 100,
    title: 'Adversarial Test Song',
    artist: 'Adversarial Artist',
    lines: sampleLines,
    semitones: 0,
    guide_volume: 0.0,
    render_status: 'idle',
    render_progress: 0,
    heartbeat: Date.now(),
  };

  const completedExportProject: ProjectState = {
    ...readyProject,
    render_status: 'completed',
    render_progress: 100,
    video_url: '/static/rendered_output.mp4',
    youtube_package: {
      title: 'Adversarial Test - Official Karaoke Backing Track',
      description:
        'Long description line with https://example.com/very/long/url/that/could/overflow/if/not/properly/wrapped',
      tags: ['test', 'karaoke'],
      key_note: '0 st',
      lyrics: 'Testing adversarial line',
      privacy_status: 'public',
    },
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    setTestViewport(320, 568);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
  });

  afterEach(() => {
    cleanup();
    resetTestViewport();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Focus Area 1: Adversarial Stress on detectHorizontalOverflow
  // =========================================================================
  describe('Focus Area 1: detectHorizontalOverflow Empirical Sensitivity & Invariant Detection', () => {
    it('detects arbitrary fixed-width class w-[...px] exceeding viewport width', () => {
      const container = document.createElement('div');
      container.className = 'w-[500px]';
      document.body.appendChild(container);

      // At 320px viewport, 500px MUST violate
      const violations320 = detectHorizontalOverflow(container, 320);
      expect(violations320).toHaveLength(1);
      expect(violations320[0].reason).toContain('w-[500px]');
      expect(violations320[0].reason).toContain('exceeds viewport width 320px');

      // At 375px viewport, 500px MUST violate
      const violations375 = detectHorizontalOverflow(container, 375);
      expect(violations375).toHaveLength(1);

      // At 768px viewport, 500px does NOT exceed 768px
      const violations768 = detectHorizontalOverflow(container, 768);
      expect(violations768).toHaveLength(0);

      document.body.removeChild(container);
    });

    it('detects boundary width violations (e.g. w-[350px] on 320px vs 375px)', () => {
      const container = document.createElement('div');
      container.className = 'w-[350px]';
      document.body.appendChild(container);

      // 350px exceeds 320px
      const violations320 = detectHorizontalOverflow(container, 320);
      expect(violations320.length).toBe(1);

      // 350px fits in 375px
      const violations375 = detectHorizontalOverflow(container, 375);
      expect(violations375.length).toBe(0);

      document.body.removeChild(container);
    });

    it('detects unconstrained Tailwind named width w-96 (384px) at mobile widths (<384px)', () => {
      const unconstrained = document.createElement('div');
      unconstrained.className = 'w-96 bg-red-500';
      document.body.appendChild(unconstrained);

      const violations320 = detectHorizontalOverflow(unconstrained, 320);
      expect(violations320.length).toBe(1);
      expect(violations320[0].reason).toContain('w-96 (384px)');

      const violations375 = detectHorizontalOverflow(unconstrained, 375);
      expect(violations375.length).toBe(1);

      // When constrained by max-w-full, it should not report a violation
      const constrained = document.createElement('div');
      constrained.className = 'w-96 max-w-full bg-green-500';
      document.body.appendChild(constrained);

      const violationsConstrained320 = detectHorizontalOverflow(constrained, 320);
      expect(violationsConstrained320.length).toBe(0);

      document.body.removeChild(unconstrained);
      document.body.removeChild(constrained);
    });

    it('detects inline pixel width styles exceeding viewport', () => {
      const inlineEl = document.createElement('div');
      inlineEl.style.width = '420px';
      document.body.appendChild(inlineEl);

      const violations320 = detectHorizontalOverflow(inlineEl, 320);
      expect(violations320.length).toBe(1);
      expect(violations320[0].reason).toContain('Inline width 420px');

      const violations768 = detectHorizontalOverflow(inlineEl, 768);
      expect(violations768.length).toBe(0);

      document.body.removeChild(inlineEl);
    });

    it('detects un-wrapped horizontal flex rows exceeding viewport width and ignores flex-wrap and scrollable rows', () => {
      // 1. Un-wrapped flex container with direct button children totaling > 320px
      const unWrapped = document.createElement('div');
      unWrapped.className = 'flex items-center gap-3';
      const b1 = document.createElement('button');
      b1.textContent = 'Action Button Alpha Large Label';
      const b2 = document.createElement('button');
      b2.textContent = 'Action Button Beta Large Label';
      unWrapped.appendChild(b1);
      unWrapped.appendChild(b2);
      document.body.appendChild(unWrapped);

      const violationsUnwrapped = detectHorizontalOverflow(unWrapped, 320);
      expect(violationsUnwrapped.length).toBeGreaterThan(0);
      expect(violationsUnwrapped[0].reason).toContain('Non-wrapping flex container');

      // 2. Same buttons with flex-wrap
      const wrapped = document.createElement('div');
      wrapped.className = 'flex flex-wrap items-center gap-3';
      wrapped.appendChild(b1.cloneNode(true));
      wrapped.appendChild(b2.cloneNode(true));
      document.body.appendChild(wrapped);

      const violationsWrapped = detectHorizontalOverflow(wrapped, 320);
      expect(violationsWrapped.length).toBe(0);

      // 3. Same buttons with overflow-x-auto
      const scrollable = document.createElement('div');
      scrollable.className = 'flex items-center gap-3 overflow-x-auto';
      scrollable.appendChild(b1.cloneNode(true));
      scrollable.appendChild(b2.cloneNode(true));
      document.body.appendChild(scrollable);

      const violationsScrollable = detectHorizontalOverflow(scrollable, 320);
      expect(violationsScrollable.length).toBe(0);

      document.body.removeChild(unWrapped);
      document.body.removeChild(wrapped);
      document.body.removeChild(scrollable);
    });

    it('honors responsive flex-col sm:flex-row direction: column at 320px, row at 768px', () => {
      const responsiveFlex = document.createElement('div');
      responsiveFlex.className = 'flex flex-col sm:flex-row items-center gap-4';
      const b1 = document.createElement('button');
      b1.textContent = 'Download Video File (.mp4 format)';
      const b2 = document.createElement('button');
      b2.textContent = 'Publish to YouTube Studio Directly';
      responsiveFlex.appendChild(b1);
      responsiveFlex.appendChild(b2);
      document.body.appendChild(responsiveFlex);

      // At 320px (<640px), flex-col applies -> direct items stack vertically, no row overflow
      const violations320 = detectHorizontalOverflow(responsiveFlex, 320);
      expect(violations320.length).toBe(0);

      // At 768px (>=640px), sm:flex-row applies -> items fit in 768px width
      const violations768 = detectHorizontalOverflow(responsiveFlex, 768);
      expect(violations768.length).toBe(0);

      document.body.removeChild(responsiveFlex);
    });

    it('detects unformatted <pre> text blocks lacking word-wrap or horizontal scroll', () => {
      const badPre = document.createElement('pre');
      badPre.className = 'bg-slate-900 text-xs font-mono p-4';
      badPre.textContent = 'some super long unbroken code block or youtube description text';
      document.body.appendChild(badPre);

      const violationsBad = detectHorizontalOverflow(badPre, 320);
      expect(violationsBad.length).toBe(1);
      expect(violationsBad[0].reason).toContain(
        'Preformatted text container lacks overflow scrolling or word-wrapping'
      );

      // Good pre with whitespace-pre-wrap and break-words
      const goodPre = document.createElement('pre');
      goodPre.className =
        'bg-slate-900 text-xs font-mono p-4 whitespace-pre-wrap break-words overflow-x-auto';
      goodPre.textContent = 'some super long unbroken code block or youtube description text';
      document.body.appendChild(goodPre);

      const violationsGood = detectHorizontalOverflow(goodPre, 320);
      expect(violationsGood.length).toBe(0);

      document.body.removeChild(badPre);
      document.body.removeChild(goodPre);
    });

    it('ignores elements that are hidden at the given viewport width', () => {
      // Element hidden on mobile with hidden md:flex
      const desktopOnlyWide = document.createElement('div');
      desktopOnlyWide.className = 'hidden md:flex w-[600px]';
      document.body.appendChild(desktopOnlyWide);

      // At 320px, element is hidden, so no violation
      const violations320 = detectHorizontalOverflow(desktopOnlyWide, 320);
      expect(violations320.length).toBe(0);

      // At 768px, element is visible and 600px fits in 768px
      const violations768 = detectHorizontalOverflow(desktopOnlyWide, 768);
      expect(violations768.length).toBe(0);

      document.body.removeChild(desktopOnlyWide);
    });

    // CRUCIAL ADVERSARIAL TEST: Injecting simulated overflow into real component trees
    it('catches simulated fixed-width overflow when injected into real component trees and throws assertZeroHorizontalOverflow', () => {
      setTestViewport(320, 568);
      const { container } = render(
        <AuthModal isOpen={true} onSuccess={vi.fn()} onClose={vi.fn()} />
      );

      // Baseline: zero horizontal overflow
      expect(() => assertZeroHorizontalOverflow(container, 320)).not.toThrow();

      // INJECT ADVERSARIAL OVERFLOW: append a fixed-width 450px div into the dialog
      const dialog = container.querySelector('[role="dialog"]');
      expect(dialog).toBeInTheDocument();
      const injectedBomb = document.createElement('div');
      injectedBomb.className = 'w-[450px] h-10 bg-red-600';
      dialog?.appendChild(injectedBomb);

      // assertZeroHorizontalOverflow MUST catch this and throw an assertion failure!
      expect(() => assertZeroHorizontalOverflow(container, 320)).toThrow(
        /Horizontal overflow detected at 320px viewport/
      );

      // Clean up injected element
      dialog?.removeChild(injectedBomb);
    });

    it('catches injected non-wrapping flex row when injected into ExportModal and throws', () => {
      setTestViewport(320, 568);
      const { container } = render(
        <ExportModal
          project={completedExportProject}
          isOpen={true}
          onClose={vi.fn()}
          onCancelRender={vi.fn()}
        />
      );

      // Baseline passes
      expect(() => assertZeroHorizontalOverflow(container, 320)).not.toThrow();

      // INJECT ADVERSARIAL NON-WRAPPING FLEX CONTAINER
      const modalContent = container.querySelector('.max-w-3xl');
      expect(modalContent).toBeInTheDocument();

      const injectedFlex = document.createElement('div');
      injectedFlex.className = 'flex items-center gap-4';
      const longBtn1 = document.createElement('button');
      longBtn1.textContent = 'Very Long Action Button That Will Cause Flex Row Overflow';
      const longBtn2 = document.createElement('button');
      longBtn2.textContent = 'Second Very Long Action Button That Extends Past 320px';
      injectedFlex.appendChild(longBtn1);
      injectedFlex.appendChild(longBtn2);
      modalContent?.appendChild(injectedFlex);

      // assertZeroHorizontalOverflow MUST fail
      expect(() => assertZeroHorizontalOverflow(container, 320)).toThrow(
        /Non-wrapping flex container has direct items totaling estimated min-width/
      );

      modalContent?.removeChild(injectedFlex);
    });
  });

  // =========================================================================
  // Focus Area 2: Adversarial Stress on assertTouchTargets
  // =========================================================================
  describe('Focus Area 2: assertTouchTargets Empirical Evaluation', () => {
    it('correctly flags sub-standard touch targets (e.g. p-1, w-4 h-4, unstyled buttons)', () => {
      const container = document.createElement('div');

      const smallBtn1 = document.createElement('button');
      smallBtn1.className = 'p-1 text-xs text-white';
      smallBtn1.textContent = 'Tiny';

      const smallBtn2 = document.createElement('button');
      smallBtn2.className = 'w-4 h-4 rounded';
      smallBtn2.setAttribute('aria-label', 'Close Icon');

      const smallInput = document.createElement('input');
      smallInput.className = 'h-6 text-xs px-1';

      const smallLink = document.createElement('a');
      smallLink.href = '#';
      smallLink.className = 'text-xs text-blue-400';
      smallLink.textContent = 'Terms';

      const smallDivBtn = document.createElement('div');
      smallDivBtn.setAttribute('role', 'button');
      smallDivBtn.className = 'text-xs';
      smallDivBtn.textContent = 'CustomDivBtn';

      const smallTab = document.createElement('div');
      smallTab.setAttribute('role', 'tab');
      smallTab.className = 'p-1 text-xs';
      smallTab.textContent = 'Tab 1';

      container.appendChild(smallBtn1);
      container.appendChild(smallBtn2);
      container.appendChild(smallInput);
      container.appendChild(smallLink);
      container.appendChild(smallDivBtn);
      container.appendChild(smallTab);
      document.body.appendChild(container);

      const result = assertTouchTargets(container, 44);
      expect(result.total).toBe(6);
      expect(result.failed).toHaveLength(6);

      const failedLabels = result.failed.map((f) => f.text);
      expect(failedLabels).toContain('Tiny');
      expect(failedLabels).toContain('Close Icon');
      expect(failedLabels).toContain('Terms');
      expect(failedLabels).toContain('CustomDivBtn');
      expect(failedLabels).toContain('Tab 1');

      document.body.removeChild(container);
    });

    it('ignores disabled, aria-hidden, or display:none interactive controls', () => {
      const container = document.createElement('div');

      const disabledBtn = document.createElement('button');
      disabledBtn.disabled = true;
      disabledBtn.className = 'p-1';
      disabledBtn.textContent = 'Disabled';

      const hiddenAriaBtn = document.createElement('button');
      hiddenAriaBtn.setAttribute('aria-hidden', 'true');
      hiddenAriaBtn.className = 'p-1';
      hiddenAriaBtn.textContent = 'HiddenAria';

      const displayNoneBtn = document.createElement('button');
      displayNoneBtn.style.display = 'none';
      displayNoneBtn.className = 'p-1';
      displayNoneBtn.textContent = 'DisplayNone';

      const hiddenVisibilityBtn = document.createElement('button');
      hiddenVisibilityBtn.style.visibility = 'hidden';
      hiddenVisibilityBtn.className = 'p-1';
      hiddenVisibilityBtn.textContent = 'VisibilityHidden';

      container.appendChild(disabledBtn);
      container.appendChild(hiddenAriaBtn);
      container.appendChild(displayNoneBtn);
      container.appendChild(hiddenVisibilityBtn);
      document.body.appendChild(container);

      const result = assertTouchTargets(container, 44);
      // Disabled button is excluded by querySelector button:not([disabled])
      // aria-hidden and hidden styles are filtered out in loop
      expect(result.failed).toHaveLength(0);

      document.body.removeChild(container);
    });

    it('recognizes standard mobile touch target classes as compliant', () => {
      const container = document.createElement('div');

      const standardClasses = [
        'min-h-[44px]',
        'min-h-[48px]',
        'min-w-[44px]',
        'h-11',
        'h-12',
        'w-11',
        'w-12',
        'py-3',
        'py-3.5',
        'p-3',
        'p-3.5',
        'p-2.5',
        'py-2.5 px-4',
        'py-2.5 px-5',
        'min-h-[40px]',
        'min-h-[36px]',
      ];

      standardClasses.forEach((cls, i) => {
        const btn = document.createElement('button');
        btn.className = `${cls} bg-blue-600 text-white`;
        btn.textContent = `Btn ${i}`;
        container.appendChild(btn);
      });
      document.body.appendChild(container);

      const result = assertTouchTargets(container, 44);
      expect(result.total).toBe(standardClasses.length);
      expect(result.failed).toHaveLength(0);

      document.body.removeChild(container);
    });

    it('evaluates touch targets on AuthModal with zero substandard controls', () => {
      // 1. Initial state: submit button is disabled (loading || !password.trim() || !username.trim())
      const { container } = render(
        <AuthModal isOpen={true} onSuccess={vi.fn()} onClose={vi.fn()} />
      );

      const resultInitial = assertTouchTargets(container, 44);
      // 2 active elements: password input, username input (no close button)
      expect(resultInitial.total).toBe(2);
      expect(resultInitial.failed).toHaveLength(0);

      // 2. Type password and username to enable submit button -> 3 active elements, all compliant
      const passwordInput = screen.getByLabelText(/studio passphrase/i);
      const usernameInput = screen.getByLabelText(/your nickname/i);
      fireEvent.change(passwordInput, { target: { value: 'secret123' } });
      fireEvent.change(usernameInput, { target: { value: 'Alex' } });

      const resultFilled = assertTouchTargets(container, 44);
      expect(resultFilled.total).toBe(3);
      expect(resultFilled.failed).toHaveLength(0);
    });

    it('evaluates touch targets on ExportModal with zero substandard controls', () => {
      const { container } = render(
        <ExportModal
          project={completedExportProject}
          isOpen={true}
          onClose={vi.fn()}
          onCancelRender={vi.fn()}
        />
      );

      const result = assertTouchTargets(container, 44);
      expect(result.total).toBeGreaterThanOrEqual(4);
      expect(result.failed).toHaveLength(0);
    });

    it('evaluates touch targets on AudioControls: buttons have 100% compliant >=44px touch targets', () => {
      const { container } = render(
        <AudioControls
          projectId="test-proj"
          onMixChange={vi.fn()}
          initialSemitones={0}
          initialGuideVolume={0}
        />
      );

      // Verify all buttons in AudioControls meet touch standards
      const buttons = container.querySelectorAll<HTMLElement>('button');
      buttons.forEach((btn) => {
        const dummyWrapper = document.createElement('div');
        dummyWrapper.appendChild(btn.cloneNode(true));
        const res = assertTouchTargets(dummyWrapper, 44);
        expect(res.failed).toHaveLength(0);
      });

      // Characterization finding: assertTouchTargets on whole container also selects the
      // Tailwind 'hidden' file input (which lacks inline display:none in JSDOM)
      const containerResult = assertTouchTargets(container, 44);
      const failedTypes = containerResult.failed.map((f) => f.element.tagName.toLowerCase());
      // Every single failure is an <input> (the hidden file input), NOT a button or slider
      expect(failedTypes.every((t) => t === 'input')).toBe(true);
    });

    it('evaluates touch targets on TrackSearch controls', () => {
      const { container } = render(
        <TrackSearch
          onSelectTrack={vi.fn()}
          onOpenProject={vi.fn()}
          isLoading={false}
          currentUser="TestSinger"
        />
      );

      // Verify search input meets >= 48px
      const input = screen.getByLabelText(/paste youtube/i);
      expect(input.className).toContain('min-h-[48px]');

      // Verify search button meets >= 36px / sm:44px
      const searchBtn = screen.getByRole('button', { name: /search youtube/i });
      expect(searchBtn.className).toContain('min-h-[36px]');
      expect(searchBtn.className).toContain('sm:min-h-[44px]');

      // Verify tabs have min-h-[36px]
      const tab = screen.getByRole('tab', { name: /my songs/i });
      expect(tab.className).toContain('min-h-[36px]');

      assertZeroHorizontalOverflow(container, 320);
    });

    it('evaluates touch targets on LyricTimelineEditor controls', () => {
      const { container } = render(
        <LyricTimelineEditor
          lines={sampleLines}
          currentTime={2.0}
          duration={120}
          onSeek={vi.fn()}
          onSaveLines={vi.fn()}
        />
      );

      // Verify nudge buttons meet >=40px touch standard
      const nudgeBtns = screen.getAllByRole('button', { name: /nudge line/i });
      nudgeBtns.forEach((btn) => expectTouchTarget(btn, 40));

      // Verify line select button meets >=40px
      const lineBtn = screen.getByRole('button', { name: /select line/i });
      expectTouchTarget(lineBtn, 40);

      assertZeroHorizontalOverflow(container, 320);
    });
  });

  // =========================================================================
  // Focus Area 3: Viewport Emulation Invariants & Cross-Breakpoint Verification
  // =========================================================================
  describe('Focus Area 3: Viewport Emulation & Invariant Consistency', () => {
    it('sets all window and document properties consistently upon setTestViewport', () => {
      setTestViewport(375, 667);
      expect(window.innerWidth).toBe(375);
      expect(window.innerHeight).toBe(667);
      expect(document.documentElement.clientWidth).toBe(375);
      expect(document.documentElement.clientHeight).toBe(667);
      expect(document.documentElement.scrollWidth).toBe(375);
      expect(document.documentElement.scrollHeight).toBe(667);

      // Verify resize event was dispatched
      let resizeFired = false;
      const listener = () => {
        resizeFired = true;
      };
      window.addEventListener('resize', listener);
      setTestViewport(768, 1024);
      expect(resizeFired).toBe(true);
      window.removeEventListener('resize', listener);

      // Verify resetTestViewport restores 1280x800
      resetTestViewport();
      expect(window.innerWidth).toBe(1280);
      expect(window.innerHeight).toBe(800);
      expect(document.documentElement.clientWidth).toBe(1280);
    });

    it('maintains strict BREAKPOINTS contract: 320px, 375px, 768px, 1280px', () => {
      expect(BREAKPOINTS).toHaveLength(4);
      expect(BREAKPOINTS.map((b) => b.width)).toEqual([320, 375, 768, 1280]);
    });

    it('survives rapid successive viewport switching without flakiness or state contamination', () => {
      const { container } = render(
        <AuthModal isOpen={true} onSuccess={vi.fn()} onClose={vi.fn()} />
      );

      // Cycle rapidly across all breakpoints 5 times
      for (let cycle = 0; cycle < 5; cycle++) {
        for (const bp of BREAKPOINTS) {
          setTestViewport(bp.width, bp.height);
          assertZeroHorizontalOverflow(container, bp.width);
          expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
            document.documentElement.clientWidth
          );
        }
      }
    });
  });
});
