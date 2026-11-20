import React, { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { AudioControls } from '../../components/AudioControls';
import {
  VocalPartsControl,
  type VocalPartsControlProps,
} from '../../components/audio/VocalPartsControl';
import type { SingerRole, VocalLevels } from '../../types';

const DUET: SingerRole[] = ['singer1', 'singer2'];

function setup(props: Partial<VocalPartsControlProps> = {}, initial: VocalLevels = {}) {
  const onChange = vi.fn();
  const onCommit = vi.fn();
  const Harness = () => {
    const [levels, setLevels] = useState(initial);
    return (
      <VocalPartsControl
        guideVolume={0.2}
        singerParts={[]}
        {...props}
        levels={levels}
        onLevelsChange={(next) => {
          onChange(next);
          setLevels(next);
        }}
        onLevelsCommit={(next) => {
          onCommit(next);
          setLevels(next);
        }}
      />
    );
  };
  render(<Harness />);
  return { onChange, onCommit };
}

const slide = (name: string, value: number) => {
  const slider = screen.getByRole('slider', { name });
  fireEvent.change(slider, { target: { value: String(value) } });
  fireEvent.pointerUp(slider);
  return slider;
};

describe('Backing vocals level', () => {
  it('is offered only once the vocals are split', () => {
    setup({ split: { onSplit: vi.fn() } });
    expect(
      screen.getByRole('button', { name: 'Split lead and backing vocals' })
    ).toBeInTheDocument();
    expect(screen.queryByRole('slider', { name: 'Backing vocals level' })).toBeNull();
  });

  it('starts at the guide level and is mixed when the slider is released', () => {
    const { onChange, onCommit } = setup({ split: { split: { model: 'm' } } });
    const slider = screen.getByRole('slider', { name: 'Backing vocals level' });
    expect(slider).toHaveValue('0.2');
    expect(slider).toHaveAttribute('aria-valuetext', 'Backing vocals at 20%');

    slide('Backing vocals level', 1);

    expect(onChange).toHaveBeenLastCalledWith({ backing: 1 });
    expect(onCommit).toHaveBeenLastCalledWith({ backing: 1 });
    expect(within(screen.getByTestId('vocal-level-backing')).getByText('100%')).toBeInTheDocument();
  });

  it('reads as removed at zero', () => {
    setup({ split: { split: { model: 'm' } } }, { backing: 0 });
    expect(screen.getByRole('slider', { name: 'Backing vocals level' })).toHaveAttribute(
      'aria-valuetext',
      'Backing vocals removed'
    );
  });
});

describe('Lead by singer', () => {
  it('is not offered for a song with one singer', () => {
    setup({ singerParts: ['singer1'] }, { by: 'lines', singer1: 0.9 });
    expect(screen.queryByTestId('vocal-singers')).toBeNull();
    expect(screen.queryByRole('slider')).toBeNull();
  });

  it('starts as one level and divides at the guide level, mixing at once', () => {
    const { onCommit } = setup({ singerParts: DUET });
    expect(screen.getByRole('radio', { name: 'One level' })).toBeChecked();
    expect(screen.queryByRole('slider', { name: 'Singer 2 level' })).toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: 'By singer' }));

    expect(onCommit).toHaveBeenLastCalledWith({ by: 'lines', singer1: 0.2, singer2: 0.2 });
    expect(screen.getByRole('slider', { name: 'Singer 1 level' })).toHaveValue('0.2');
    expect(screen.getByRole('slider', { name: 'Singer 2 level' })).toHaveValue('0.2');
    expect(screen.queryByRole('slider', { name: 'Sung together level' })).toBeNull();
  });

  it('sets one singer`s level and leaves the other', () => {
    const { onCommit } = setup({ singerParts: DUET }, { by: 'lines', singer1: 0, singer2: 0.2 });

    slide('Singer 2 level', 1);

    expect(onCommit).toHaveBeenLastCalledWith({ by: 'lines', singer1: 0, singer2: 1 });
    expect(screen.getByRole('slider', { name: 'Singer 1 level' })).toHaveAttribute(
      'aria-valuetext',
      'Singer 1 removed'
    );
  });

  it('has a level for lines sung together when the song has them', () => {
    setup({ singerParts: ['singer1', 'singer2', 'both'] }, { by: 'lines' });
    expect(screen.getByRole('slider', { name: 'Sung together level' })).toBeInTheDocument();
  });

  it('uses the names the song gave its parts', () => {
    setup(
      { singerParts: DUET, partNames: { singer1: 'Elton', singer2: ' Kiki ' } },
      { by: 'lines' }
    );
    expect(screen.getByRole('slider', { name: 'Elton level' })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Kiki level' })).toBeInTheDocument();
  });

  it('goes back to one level, keeping the singers` levels for next time', () => {
    const { onCommit } = setup({ singerParts: DUET }, { by: 'lines', singer1: 0, singer2: 1 });

    fireEvent.click(screen.getByRole('radio', { name: 'One level' }));
    expect(onCommit).toHaveBeenLastCalledWith({ singer1: 0, singer2: 1 });
    expect(screen.queryByRole('slider', { name: 'Singer 2 level' })).toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: 'By singer' }));
    expect(onCommit).toHaveBeenLastCalledWith({ by: 'lines', singer1: 0, singer2: 1 });
  });

  it('does not mix again when the chosen mode is chosen again', () => {
    const { onCommit } = setup({ singerParts: DUET });
    fireEvent.click(screen.getByRole('radio', { name: 'One level' }));
    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe('Lead by male and female voice', () => {
  const voiceSplit = { onSplit: vi.fn() };

  it('is a third choice when the app can split the voices, even for one singer', () => {
    setup({ singerParts: ['singer1'], voiceSplit });
    expect(screen.getAllByRole('radio').map((radio) => radio.textContent)).toEqual([
      'One level',
      'Male / female',
    ]);
  });

  it('sits next to By singer for a song with two singers', () => {
    setup({ singerParts: DUET, voiceSplit });
    expect(screen.getAllByRole('radio').map((radio) => radio.textContent)).toEqual([
      'One level',
      'By singer',
      'Male / female',
    ]);
  });

  it('offers the split first, and keeps the levels for when the voices are there', () => {
    const onSplit = vi.fn();
    const { onCommit } = setup({ singerParts: DUET, voiceSplit: { onSplit } });

    fireEvent.click(screen.getByRole('radio', { name: 'Male / female' }));

    expect(onCommit).toHaveBeenLastCalledWith({ by: 'voices', male: 0.2, female: 0.2 });
    expect(screen.queryByRole('slider', { name: 'Male voice level' })).toBeNull();
    expect(screen.getByRole('heading', { level: 4, name: 'Male and female voices' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Split male and female voices' }));
    expect(onSplit).toHaveBeenCalledTimes(1);
  });

  it('shows the split running in its own row', () => {
    setup(
      {
        singerParts: DUET,
        voiceSplit: {
          onSplit: vi.fn(),
          onCancel: vi.fn(),
          job: { id: 'j', status: 'running', kind: 'male_female', progress: 30 },
        },
      },
      { by: 'voices' }
    );
    expect(screen.getByRole('progressbar', { name: 'Voice split progress' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel voice split' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Split male and female voices' })).toBeNull();
  });

  it('has a level for each voice once they are split', () => {
    const { onCommit } = setup(
      { singerParts: DUET, voiceSplit: { split: { model: 'duet', source: 'lead' } } },
      { by: 'voices', male: 0, female: 0.2 }
    );
    expect(screen.getByRole('slider', { name: 'Male voice level' })).toHaveAttribute(
      'aria-valuetext',
      'Male voice removed'
    );

    slide('Female voice level', 1);

    expect(onCommit).toHaveBeenLastCalledWith({ by: 'voices', male: 0, female: 1 });
    expect(screen.queryByRole('slider', { name: 'Singer 1 level' })).toBeNull();
  });

  it('is not offered when the app does not wire the split', () => {
    setup({ singerParts: ['singer1'] }, { by: 'voices', male: 0 });
    expect(screen.queryByTestId('vocal-singers')).toBeNull();
  });
});

describe('The guide vocal next to the vocal parts', () => {
  const controls = (levels: VocalLevels, singerParts: SingerRole[]) =>
    render(
      <AudioControls
        projectId="p1"
        semitones={0}
        guideVolume={0.2}
        vocalParts={{
          levels,
          guideVolume: 0.2,
          onLevelsChange: vi.fn(),
          onLevelsCommit: vi.fn(),
          singerParts,
        }}
      />
    );

  it('is switched off while the lead is set per singer', () => {
    controls({ by: 'lines', singer1: 0, singer2: 1 }, DUET);
    expect(screen.getByRole('slider', { name: 'Guide vocal volume level' })).toBeDisabled();
  });

  it('is switched off while the two voices have their own levels, once they are split', () => {
    const parts = (split?: { model: string }) => (
      <AudioControls
        projectId="p1"
        semitones={0}
        guideVolume={0.2}
        vocalParts={{
          levels: { by: 'voices', male: 0, female: 1 },
          guideVolume: 0.2,
          onLevelsChange: vi.fn(),
          onLevelsCommit: vi.fn(),
          singerParts: ['singer1'],
          voiceSplit: { split, onSplit: vi.fn() },
        }}
      />
    );
    const { rerender } = render(parts());
    // Not split yet: the levels wait, and the guide still sets the lead
    expect(screen.getByRole('slider', { name: 'Guide vocal volume level' })).toBeEnabled();
    rerender(parts({ model: 'duet' }));
    expect(screen.getByRole('slider', { name: 'Guide vocal volume level' })).toBeDisabled();
  });

  it('stays in charge of a song with one level, or one singer', () => {
    const { unmount } = controls({}, DUET);
    expect(screen.getByRole('slider', { name: 'Guide vocal volume level' })).toBeEnabled();
    unmount();
    // Singer levels kept from before the lines were re-assigned to one singer
    controls({ by: 'lines', singer1: 0 }, ['singer1']);
    expect(screen.getByRole('slider', { name: 'Guide vocal volume level' })).toBeEnabled();
  });

  it('is all there is when the app passes no vocal parts', () => {
    render(<AudioControls projectId="p1" onMixChange={vi.fn()} />);
    expect(screen.queryByTestId('vocal-parts')).toBeNull();
    expect(screen.getByRole('slider', { name: 'Guide vocal volume level' })).toBeEnabled();
  });
});
