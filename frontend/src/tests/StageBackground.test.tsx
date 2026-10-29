/**
 * Stage backgrounds: each style draws what the exported video draws (the export's own cover
 * art still, the drift, aurora orbs at their song-time positions, the spectrum canvas, an
 * upload), the scrim only where the export has one, and reduced motion.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { StageBackground } from '../components/stage/StageBackground';
import { StageSpectrum } from '../components/stage/StageSpectrum';
import { LyricDisplay } from '../components/LyricDisplay';
import { driftLayer, orbCentre, orbSize } from '../theme/stageBackgrounds';

const ART = '/api/project/p1/backdrop?aspect=16:9';
const PALETTE: [string, string, string] = ['#fbbf24', '#f472b6', '#5eead4'];

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const orbTransform = (i: number, time: number) => {
  // The stage measures 640x360 before layout (jsdom)
  const size = orbSize(640, 360);
  const c = orbCentre(i, time);
  return `translate3d(${(c.x * 640 - size / 2).toFixed(1)}px, ${(c.y * 360 - size / 2).toFixed(1)}px, 0)`;
};

describe('StageBackground', () => {
  it('draws the export cover-art still as it is, with no fade, blur or scrim', () => {
    render(<StageBackground baseColor="#0b0b12" albumArtUrl="/thumb.jpg" artworkUrl={ART} />);
    const art = screen.getByTestId('stage-album-art');
    expect(art.style.backgroundImage).toContain(ART);
    expect(art.style.filter).toBe('');
    expect(art.className).not.toMatch(/opacity|blur/);
    expect(screen.queryByTestId('stage-scrim')).toBeNull();
  });

  it('imitates the export look when only the raw thumbnail is known', () => {
    render(<StageBackground albumArtUrl="https://example.com/art.jpg" />);
    const art = screen.getByTestId('stage-album-art');
    expect(art.style.backgroundImage).toContain('https://example.com/art.jpg');
    expect(art.style.filter).toBe('blur(19.6px) brightness(0.6532) contrast(1.684)');
  });

  it('shows the stage colour when the cover-art still cannot load', () => {
    class FailingImage {
      onerror: (() => void) | null = null;
      set src(_url: string) {
        queueMicrotask(() => this.onerror?.());
      }
    }
    vi.stubGlobal('Image', FailingImage);
    render(<StageBackground albumArtUrl="https://i.ytimg.com/x.jpg" artworkUrl={ART} />);
    return act(async () => {}).then(() => {
      expect(screen.queryByTestId('stage-album-art')).toBeNull();
    });
  });

  it('pans the larger drift still along the song-time path', () => {
    const numbers = (value: string) => (value.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
    const expectLayer = (el: HTMLElement, time: number) => {
      const layer = driftLayer(time, '9:16');
      expect(parseFloat(el.style.width)).toBeCloseTo(parseFloat(layer.width), 3);
      expect(parseFloat(el.style.left)).toBeCloseTo(parseFloat(layer.left), 3);
      numbers(el.style.transform).forEach((n, i) =>
        expect(n).toBeCloseTo(numbers(layer.transform)[i], 3)
      );
    };
    const artworkUrl = `${ART}&drift=1`;
    const { rerender } = render(
      <StageBackground style="drift" artworkUrl={artworkUrl} time={12} aspect="9:16" />
    );
    expect(screen.getByTestId('stage-album-art').dataset.style).toBe('drift');
    expectLayer(screen.getByTestId('stage-album-art'), 12);

    rerender(<StageBackground style="drift" artworkUrl={artworkUrl} time={30} aspect="9:16" />);
    expectLayer(screen.getByTestId('stage-album-art'), 30);
  });

  it('places the aurora orbs where the export does at that moment, under the scrim', () => {
    render(<StageBackground style="aurora" palette={PALETTE} time={9} albumArtUrl="/t.jpg" />);
    expect(screen.queryByTestId('stage-album-art')).toBeNull();
    [0, 1, 2].forEach((i) => {
      const orb = screen.getByTestId(`stage-aurora-orb-${i}`);
      expect(orb.style.transform).toBe(orbTransform(i, 9));
    });
    expect(screen.getByTestId('stage-aurora-orb-0').style.background).toContain('251 191 36');
    expect(screen.getByTestId('stage-scrim').style.backgroundImage).toContain('rgb(0 0 0 / 0.75)');
  });

  it('holds moving styles still for viewers who ask for reduced motion', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({
          matches: query.includes('reduce'),
          media: query,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        }) as unknown as MediaQueryList
    );
    render(<StageBackground style="aurora" palette={PALETTE} time={42} />);
    expect(screen.getByTestId('stage-aurora-orb-1').style.transform).toBe(orbTransform(1, 0));
  });

  it('draws the spectrum under a white scrim on light presets', () => {
    render(<StageBackground style="spectrum" palette={PALETTE} tone="light" />);
    expect(screen.getByTestId('stage-spectrum')).toBeInTheDocument();
    expect(screen.getByTestId('stage-scrim').style.backgroundImage).toContain(
      'rgb(255 255 255 / 0.75)'
    );
  });

  it('shows only the stage colour for the plain style', () => {
    render(<StageBackground style="color" baseColor="#17120a" artworkUrl={ART} />);
    expect(screen.getByTestId('stage-base-bg').style.backgroundColor).toBe('rgb(23, 18, 10)');
    expect(screen.queryByTestId('stage-album-art')).toBeNull();
    expect(screen.queryByTestId('stage-scrim')).toBeNull();
  });

  it('shows an upload over any style, without a scrim, as exports do', () => {
    render(
      <StageBackground style="aurora" media={{ url: '/static/backgrounds/a.mp4', kind: 'video' }} />
    );
    expect(screen.getByTestId('stage-custom-bg').tagName).toBe('VIDEO');
    expect(screen.queryByTestId('stage-aurora')).toBeNull();
    expect(screen.queryByTestId('stage-scrim')).toBeNull();
  });

  it('is fed the style, palette and song time by the stage', () => {
    render(
      <LyricDisplay
        lines={[]}
        currentTime={9}
        backgroundStyle="aurora"
        backgroundPalette={PALETTE}
      />
    );
    expect(screen.getByTestId('stage-aurora-orb-2').style.transform).toBe(orbTransform(2, 9));
  });
});

describe('StageSpectrum', () => {
  const analyserWithContext = () => {
    const own = {
      fftSize: 0,
      smoothingTimeConstant: 0,
      frequencyBinCount: 4096,
      context: { sampleRate: 44100 },
      getFloatFrequencyData: vi.fn((data: Float32Array) => data.fill(-20)),
    };
    const source = {
      context: { createAnalyser: vi.fn(() => own) },
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
    return { own, source: source as unknown as AnalyserNode };
  };

  it('listens through its own detailed analyser and lets go of it on unmount', () => {
    const { own, source } = analyserWithContext();
    const { unmount } = render(<StageSpectrum analyserNode={source} palette={PALETTE} />);
    expect(own.fftSize).toBe(8192);
    expect(source.connect).toHaveBeenCalledWith(own);
    unmount();
    expect(source.disconnect).toHaveBeenCalledWith(own);
  });

  it('animates only while playing', () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame');
    const cancel = vi.spyOn(window, 'cancelAnimationFrame');
    const { source, own } = analyserWithContext();
    const { rerender } = render(<StageSpectrum analyserNode={source} palette={PALETTE} />);
    expect(raf).not.toHaveBeenCalled();
    expect(own.getFloatFrequencyData).not.toHaveBeenCalled();

    rerender(<StageSpectrum analyserNode={source} palette={PALETTE} isPlaying />);
    expect(raf).toHaveBeenCalled();
    expect(own.getFloatFrequencyData).toHaveBeenCalled();

    rerender(<StageSpectrum analyserNode={source} palette={PALETTE} isPlaying={false} />);
    expect(cancel).toHaveBeenCalled();
  });

  it('stands still for reduced motion and copes without an analyser context', () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame');
    const plain = {
      frequencyBinCount: 64,
      getFloatFrequencyData: vi.fn(),
    } as unknown as AnalyserNode;
    render(<StageSpectrum analyserNode={plain} palette={PALETTE} isPlaying frozen />);
    expect(raf).not.toHaveBeenCalled();
    render(<StageSpectrum analyserNode={plain} palette={PALETTE} isPlaying />);
    expect(plain.getFloatFrequencyData).toHaveBeenCalled();
  });
});
