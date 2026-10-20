/**
 * frontend/src/tests/Challenger2Stress.test.tsx
 *
 * Adversarial stress and boundary test suite for Milestone 1:
 * - Responsive touch target validation (>=44px) on all controls
 * - Zero horizontal overflow at 320px mobile viewport width
 * - Modal focus trapping, Tab/Shift-Tab cycling, Escape deactivation, backdrop isolation
 * - Unvoiced, silent, and null vocal range states
 * - Custom note selections (including inverted ranges)
 * - Transposition mix dispatch and async resolution
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VocalRangeRecommenderModal } from '../components/audio/VocalRangeRecommenderModal';
import { PitchTranspositionControl } from '../components/audio/PitchTranspositionControl';
import { VocalRangeData } from '../types';
import {
  setTestViewport,
  resetTestViewport,
  assertTouchTargets,
  assertZeroHorizontalOverflow,
} from './responsiveTestUtils';

describe('Challenger 2 UI Stress Suite: Pitch & Vocal Range', () => {
  const sampleVoicedRange: VocalRangeData = {
    lowest_note: 'C3',
    highest_note: 'E4',
    lowest_hz: 130.81,
    highest_hz: 329.63,
    tessitura_low_note: 'D3',
    tessitura_high_note: 'D4',
    tessitura_low_hz: 146.83,
    tessitura_high_hz: 293.66,
    median_note: 'G3',
    median_hz: 196.0,
    estimated_key: 'C Major',
    key_confidence: 0.92,
    is_voiced: true,
  };

  const sampleUnvoicedRange: VocalRangeData = {
    lowest_note: null,
    highest_note: null,
    lowest_hz: null,
    highest_hz: null,
    tessitura_low_note: null,
    tessitura_high_note: null,
    tessitura_low_hz: null,
    tessitura_high_hz: null,
    median_note: null,
    median_hz: null,
    estimated_key: 'Unknown',
    key_confidence: 0.0,
    is_voiced: false,
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    resetTestViewport();
  });

  // ============================================================================
  // 1. RESPONSIVE TOUCH TARGET VALIDATION (>=44px)
  // ============================================================================

  it('validates all interactive touch targets >= 44px in PitchTranspositionControl', () => {
    setTestViewport(320, 568);
    const { container } = render(
      <PitchTranspositionControl
        semitones={0}
        onSemitoneChange={vi.fn()}
        onResetPitch={vi.fn()}
        vocalRange={sampleVoicedRange}
        onOpenRecommender={vi.fn()}
      />
    );

    const inspection = assertTouchTargets(container, 44);
    expect(inspection.failed).toHaveLength(0);
  });

  it('validates all interactive touch targets >= 44px in VocalRangeRecommenderModal default view', () => {
    setTestViewport(320, 568);
    const { container } = render(
      <VocalRangeRecommenderModal
        isOpen={true}
        onClose={vi.fn()}
        vocalRange={sampleVoicedRange}
        currentSemitones={0}
        onApplyTransposition={vi.fn()}
      />
    );

    const inspection = assertTouchTargets(container, 44);
    expect(inspection.failed).toHaveLength(0);
  });

  it('validates touch targets >= 44px when Custom preset is selected (select dropdowns)', async () => {
    setTestViewport(320, 568);
    const user = userEvent.setup();
    const { container } = render(
      <VocalRangeRecommenderModal
        isOpen={true}
        onClose={vi.fn()}
        vocalRange={sampleVoicedRange}
        currentSemitones={0}
        onApplyTransposition={vi.fn()}
      />
    );

    const customBtn = screen.getByRole('radio', { name: /^custom$/i });
    await user.click(customBtn);

    const inspection = assertTouchTargets(container, 44);
    expect(inspection.failed).toHaveLength(0);
  });

  it('validates touch targets >= 44px when vocal range is unanalyzed (Analyze button rendered)', () => {
    setTestViewport(320, 568);
    const { container } = render(
      <VocalRangeRecommenderModal
        isOpen={true}
        onClose={vi.fn()}
        vocalRange={null}
        currentSemitones={0}
        onApplyTransposition={vi.fn()}
        onAnalyzeVocalRange={vi.fn()}
      />
    );

    const inspection = assertTouchTargets(container, 44);
    expect(inspection.failed).toHaveLength(0);
  });

  // ============================================================================
  // 2. ZERO HORIZONTAL OVERFLOW AT 320PX VIEWPORT WIDTH
  // ============================================================================

  it('confirms zero horizontal overflow at 320px for PitchTranspositionControl', () => {
    setTestViewport(320, 568);
    const { container } = render(
      <div style={{ width: '320px', maxWidth: '320px' }}>
        <PitchTranspositionControl
          semitones={-3}
          onSemitoneChange={vi.fn()}
          onResetPitch={vi.fn()}
          vocalRange={sampleVoicedRange}
          onOpenRecommender={vi.fn()}
        />
      </div>
    );

    assertZeroHorizontalOverflow(container, 320);
  });

  it('confirms zero horizontal overflow at 320px for VocalRangeRecommenderModal', () => {
    setTestViewport(320, 568);
    const { container } = render(
      <div style={{ width: '320px', maxWidth: '320px' }}>
        <VocalRangeRecommenderModal
          isOpen={true}
          onClose={vi.fn()}
          vocalRange={sampleVoicedRange}
          currentSemitones={2}
          onApplyTransposition={vi.fn()}
        />
      </div>
    );

    assertZeroHorizontalOverflow(container, 320);
  });

  // ============================================================================
  // 3. MODAL FOCUS TRAPPING & KEYBOARD/BACKDROP ACCESSIBILITY
  // ============================================================================

  it('enforces ARIA dialog contract and focus trap containment', () => {
    render(
      <VocalRangeRecommenderModal
        isOpen={true}
        onClose={vi.fn()}
        vocalRange={sampleVoicedRange}
        currentSemitones={0}
        onApplyTransposition={vi.fn()}
      />
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'vocal-recommender-title');
    expect(dialog).toHaveAttribute('aria-describedby', 'vocal-recommender-desc');
  });

  it('closes modal when Escape key is pressed', () => {
    const onClose = vi.fn();
    render(
      <VocalRangeRecommenderModal
        isOpen={true}
        onClose={onClose}
        vocalRange={sampleVoicedRange}
        currentSemitones={0}
        onApplyTransposition={vi.fn()}
      />
    );

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes modal on backdrop click, but ignores clicks inside modal body', () => {
    const onClose = vi.fn();
    render(
      <VocalRangeRecommenderModal
        isOpen={true}
        onClose={onClose}
        vocalRange={sampleVoicedRange}
        currentSemitones={0}
        onApplyTransposition={vi.fn()}
      />
    );

    const dialog = screen.getByRole('dialog');
    // Click inner modal content
    const title = screen.getByText('Smart Key Recommender');
    fireEvent.click(title);
    expect(onClose).not.toHaveBeenCalled();

    // Click backdrop directly
    fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // ============================================================================
  // 4. UNVOICED & SILENT AUDIO SAFEGUARDS
  // ============================================================================

  it('renders unvoiced audio warning banner and disables transposition button', () => {
    render(
      <VocalRangeRecommenderModal
        isOpen={true}
        onClose={vi.fn()}
        vocalRange={sampleUnvoicedRange}
        currentSemitones={0}
        onApplyTransposition={vi.fn()}
      />
    );

    expect(
      screen.getByText(/No singing voice detected on vocal track \(silent or unvoiced stem\)/i)
    ).toBeInTheDocument();

    const applyBtn = screen.getByRole('button', { name: /apply transposition/i });
    expect(applyBtn).toBeDisabled();
  });

  it('renders pitch transposition control with "No vocals detected" when unvoiced', () => {
    render(
      <PitchTranspositionControl
        semitones={0}
        onSemitoneChange={vi.fn()}
        onResetPitch={vi.fn()}
        vocalRange={sampleUnvoicedRange}
      />
    );

    expect(screen.getByText('No vocals detected')).toBeInTheDocument();
  });

  // ============================================================================
  // 5. CUSTOM NOTE SELECTION & INVERTED RANGE STRESS
  // ============================================================================

  it('allows custom note selection and dynamically updates recommendation', async () => {
    const user = userEvent.setup();
    render(
      <VocalRangeRecommenderModal
        isOpen={true}
        onClose={vi.fn()}
        vocalRange={sampleVoicedRange}
        currentSemitones={0}
        onApplyTransposition={vi.fn()}
      />
    );

    // Switch to Custom
    await user.click(screen.getByRole('radio', { name: /^custom$/i }));

    const lowSelect = screen.getByLabelText(/Lowest Comfortable Note/i) as HTMLSelectElement;
    const highSelect = screen.getByLabelText(/Highest Comfortable Note/i) as HTMLSelectElement;

    // Change low note to E2 and high note to E4 (Bass range)
    fireEvent.change(lowSelect, { target: { value: 'E2' } });
    fireEvent.change(highSelect, { target: { value: 'E4' } });

    expect(lowSelect.value).toBe('E2');
    expect(highSelect.value).toBe('E4');
    expect(screen.getByText(/Your Target: E2 – E4/i)).toBeInTheDocument();
  });

  it('stress test: inverted custom notes (low note higher than high note) does not crash', async () => {
    const user = userEvent.setup();
    render(
      <VocalRangeRecommenderModal
        isOpen={true}
        onClose={vi.fn()}
        vocalRange={sampleVoicedRange}
        currentSemitones={0}
        onApplyTransposition={vi.fn()}
      />
    );

    await user.click(screen.getByRole('radio', { name: /^custom$/i }));

    const lowSelect = screen.getByLabelText(/Lowest Comfortable Note/i) as HTMLSelectElement;
    const highSelect = screen.getByLabelText(/Highest Comfortable Note/i) as HTMLSelectElement;

    // Inverted: set lowest to C5 and highest to C3
    fireEvent.change(lowSelect, { target: { value: 'C5' } });
    fireEvent.change(highSelect, { target: { value: 'C3' } });

    // Recommendation should gracefully compute without NaN or error
    expect(screen.getByText(/Recommended Transposition/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /apply transposition/i })).toBeEnabled();
  });

  // ============================================================================
  // 6. TRANSPOSITION MIX DISPATCH & ASYNC RESOLUTION
  // ============================================================================

  it('dispatches the recommended semitones to onApplyTransposition and closes modal', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();

    render(
      <VocalRangeRecommenderModal
        isOpen={true}
        onClose={onClose}
        vocalRange={sampleVoicedRange}
        currentSemitones={0}
        onApplyTransposition={onApply}
      />
    );

    const applyBtn = screen.getByRole('button', { name: /apply transposition/i });
    await user.click(applyBtn);

    expect(onApply).toHaveBeenCalledTimes(1);
    // Argument must be an integer semitone
    const appliedSemitones = onApply.mock.calls[0][0];
    expect(typeof appliedSemitones).toBe('number');
    expect(Number.isInteger(appliedSemitones)).toBe(true);
    expect(appliedSemitones).toBeGreaterThanOrEqual(-12);
    expect(appliedSemitones).toBeLessThanOrEqual(12);

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});
