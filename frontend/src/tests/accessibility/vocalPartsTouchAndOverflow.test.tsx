/**
 * The vocal parts controls of the Mix panel at phone widths: every button is a 44px target
 * and no row runs off the screen, with the longest content a song can give them.
 */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { VocalPartsControl } from '../../components/audio/VocalPartsControl';
import type { VocalSplitJob } from '../../types';
import {
  assertTouchTargets,
  assertZeroHorizontalOverflow,
  resetTestViewport,
  setTestViewport,
} from '../helpers/responsiveTestUtils';

const job: VocalSplitJob = {
  id: 'j1',
  status: 'running',
  kind: 'lead_backing',
  progress: 42,
  detail: 'Waiting for a cloud GPU for Lead and backing vocals split…',
  eta_seconds: 190,
};

const base = {
  guideVolume: 0.2,
  onLevelsChange: vi.fn(),
  onLevelsCommit: vi.fn(),
};

const STATES = {
  'not split, by singer with long part names': (
    <VocalPartsControl
      {...base}
      levels={{ by: 'lines', singer1: 0, singer2: 1, both: 0.5 }}
      singerParts={['singer1', 'singer2', 'both']}
      partNames={{
        singer1: 'Bartholomew Featherstonehaugh III',
        singer2: 'The Unpronounceable Symbol',
      }}
      split={{ onSplit: vi.fn(), capability: null }}
    />
  ),
  'a server that cannot split': (
    <VocalPartsControl
      {...base}
      levels={{}}
      singerParts={['singer1', 'singer2']}
      split={{
        onSplit: vi.fn(),
        capability: {
          id: 'lead_backing',
          label: 'Lead and backing vocals',
          model: 'm.ckpt',
          available: false,
          reason: 'audio-separator is not installed (see requirements-ml.txt)',
        },
      }}
    />
  ),
  'a split running': (
    <VocalPartsControl
      {...base}
      levels={{}}
      singerParts={['singer1']}
      split={{ job, onSplit: vi.fn(), onCancel: vi.fn() }}
    />
  ),
  'male and female voices, not split yet': (
    <VocalPartsControl
      {...base}
      levels={{ by: 'voices' }}
      singerParts={['singer1', 'singer2']}
      split={{ onSplit: vi.fn() }}
      voiceSplit={{
        onSplit: vi.fn(),
        capability: {
          id: 'male_female',
          label: 'Male and female voices',
          model: 'duet.ckpt',
          available: false,
          reason: 'Modal credentials are missing (MODAL_TOKEN_ID and MODAL_TOKEN_SECRET)',
        },
      }}
    />
  ),
  'male and female voices, split': (
    <VocalPartsControl
      {...base}
      levels={{ by: 'voices', male: 0, female: 1, backing: 0.5 }}
      singerParts={['singer1', 'singer2', 'both']}
      split={{ split: { model: 'm' }, onSplit: vi.fn() }}
      voiceSplit={{ split: { model: 'duet' }, onSplit: vi.fn() }}
    />
  ),
  'split, with the backing level': (
    <VocalPartsControl
      {...base}
      levels={{ backing: 1 }}
      singerParts={['singer1', 'singer2']}
      split={{ split: { model: 'm' }, onSplit: vi.fn() }}
    />
  ),
};

describe('vocal parts controls on a phone', () => {
  afterEach(() => resetTestViewport());

  for (const [name, element] of Object.entries(STATES)) {
    for (const width of [320, 375]) {
      it(`${name}: fits ${width}px with 44px targets`, () => {
        setTestViewport(width);
        const { container } = render(<div style={{ width }}>{element}</div>);

        assertZeroHorizontalOverflow(container, width);
        const targets = assertTouchTargets(container, 44);
        expect(targets.failed.map((f) => f.element.outerHTML.slice(0, 120))).toEqual([]);
      });
    }
  }
});
