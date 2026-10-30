import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VocalRangeRecommenderModal } from '../../components/audio/VocalRangeRecommenderModal';
import { VocalRangeData } from '../../types';
import {
  setTestViewport,
  resetTestViewport,
  assertTouchTargets,
  assertZeroHorizontalOverflow,
} from '../helpers/responsiveTestUtils';

describe('VocalRangeRecommenderModal Component', () => {
  const mockVocalRange: VocalRangeData = {
    lowest_note: 'C#3',
    highest_note: 'E4',
    lowest_hz: 140.6,
    highest_hz: 332.7,
    tessitura_low_note: 'B3',
    tessitura_high_note: 'D#4',
    tessitura_low_hz: 246.9,
    tessitura_high_hz: 311.1,
    median_note: 'C#4',
    median_hz: 279.9,
    estimated_key: 'C# Minor',
    key_confidence: 0.88,
    is_voiced: true,
  };

  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    vocalRange: mockVocalRange,
    currentSemitones: 0,
    onApplyTransposition: vi.fn(),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    resetTestViewport();
  });

  it('does not render when isOpen is false', () => {
    const { container } = render(<VocalRangeRecommenderModal {...defaultProps} isOpen={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders modal dialog with vocal range and estimated key', () => {
    render(<VocalRangeRecommenderModal {...defaultProps} />);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Smart Key Recommender')).toBeInTheDocument();
    expect(screen.getByText(/C#3 – E4/i)).toBeInTheDocument();
    expect(screen.getByText(/Estimated Key: C# Minor/i)).toBeInTheDocument();
  });

  it('renders all 7 preset buttons', () => {
    render(<VocalRangeRecommenderModal {...defaultProps} />);

    ['Bass', 'Baritone', 'Tenor', 'Alto', 'Mezzo-Soprano', 'Soprano', 'Custom'].forEach(
      (preset) => {
        expect(
          screen.getByRole('radio', { name: new RegExp(`^${preset}$`, 'i') })
        ).toBeInTheDocument();
      }
    );
  });

  it('updates recommendation calculation when switching presets', async () => {
    const user = userEvent.setup();
    render(<VocalRangeRecommenderModal {...defaultProps} />);

    // Click Soprano preset
    const sopranoBtn = screen.getByRole('radio', { name: /^soprano$/i });
    await user.click(sopranoBtn);

    expect(sopranoBtn).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText(/High female vocal range/i)).toBeInTheDocument();
  });

  it('reveals custom note dropdowns when Custom preset is selected', async () => {
    const user = userEvent.setup();
    render(<VocalRangeRecommenderModal {...defaultProps} />);

    const customBtn = screen.getByRole('radio', { name: /^custom$/i });
    await user.click(customBtn);

    expect(screen.getByLabelText(/Lowest Comfortable Note/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Highest Comfortable Note/i)).toBeInTheDocument();
  });

  it('calls onApplyTransposition and onClose when Apply Transposition is clicked', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    const onClose = vi.fn();

    render(
      <VocalRangeRecommenderModal
        {...defaultProps}
        onApplyTransposition={onApply}
        onClose={onClose}
      />
    );

    const applyBtn = screen.getByRole('button', { name: /apply transposition/i });
    await user.click(applyBtn);

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes modal when Escape key is pressed', () => {
    const onClose = vi.fn();
    render(<VocalRangeRecommenderModal {...defaultProps} onClose={onClose} />);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('handles unvoiced vocal stems gracefully', () => {
    const unvoicedProps = {
      ...defaultProps,
      vocalRange: { ...mockVocalRange, is_voiced: false },
    };

    render(<VocalRangeRecommenderModal {...unvoicedProps} />);

    expect(screen.getByText(/No singing voice detected on vocal track/i)).toBeInTheDocument();
    const applyBtn = screen.getByRole('button', { name: /apply transposition/i });
    expect(applyBtn).toBeDisabled();
  });

  it('satisfies touch target requirements (>=44px)', () => {
    const { container } = render(<VocalRangeRecommenderModal {...defaultProps} />);
    const result = assertTouchTargets(container, 44);
    expect(result.failed).toHaveLength(0);
  });

  it('has zero horizontal overflow down to 320px viewport', () => {
    setTestViewport(320, 568);
    const { container } = render(<VocalRangeRecommenderModal {...defaultProps} />);
    assertZeroHorizontalOverflow(container, 320);
  });
});
