/**
 * The studio's text fields stop at the lengths the server accepts
 * (`@shared/text_limits.json`): a title, an artist, a singer's name or lyrics longer than
 * that used to be sent anyway and came back as the server's 422.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import textLimits from '@shared/text_limits.json';
import { TrackSearch } from '../../components/TrackSearch';
import { LocalAudioUploader } from '../../components/track-search/LocalAudioUploader';
import { EditMetadataModal } from '../../components/EditMetadataModal';
import { LyricsLimitNote } from '../../components/LyricsLimitNote';
import { TEXT_LIMITS, lyricsAtLimit } from '../../utils/textLimits';
import { mockStudioFetch } from '../helpers/qualityFixtures';

describe('text limits shared with the server', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('are the ones the server refuses longer text with', () => {
    expect(TEXT_LIMITS).toEqual(textLimits);
    expect(textLimits).toEqual({ title: 300, artist: 300, singer: 64, lyrics: 50000 });
  });

  it('stop the title and artist of an uploaded file', () => {
    render(<LocalAudioUploader isLoading={false} customLyrics="" onError={vi.fn()} />);

    expect(screen.getByRole('textbox', { name: 'Track Title' })).toHaveAttribute(
      'maxlength',
      String(textLimits.title)
    );
    expect(screen.getByRole('textbox', { name: 'Artist Name' })).toHaveAttribute(
      'maxlength',
      String(textLimits.artist)
    );
  });

  it('stop the title and artist typed into a song’s details', () => {
    render(
      <EditMetadataModal
        isOpen
        project={{ id: 'song', title: 'Neon Skyline', artist: 'The Band' }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    expect(screen.getByDisplayValue('Neon Skyline')).toHaveAttribute(
      'maxlength',
      String(textLimits.title)
    );
    expect(screen.getByDisplayValue('The Band')).toHaveAttribute(
      'maxlength',
      String(textLimits.artist)
    );
  });

  it('stop the lyrics pasted with a song, and say so when a paste fills the field', async () => {
    mockStudioFetch();
    render(<TrackSearch onSelectTrack={vi.fn()} isLoading={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Advanced options' }));
    const lyrics = screen.getByRole('textbox', { name: /Custom lyrics/ });

    expect(lyrics).toHaveAttribute('maxlength', String(textLimits.lyrics));
    expect(screen.queryByText(/Lyrics stop at/)).not.toBeInTheDocument();

    fireEvent.change(lyrics, {
      target: { value: 'la\n'.repeat(textLimits.lyrics).slice(0, textLimits.lyrics) },
    });

    expect(
      screen.getByText('Lyrics stop at 50,000 characters. Anything pasted after that was left out.')
    ).toHaveAttribute('role', 'status');
  });

  it('say nothing about lyrics of an ordinary length', () => {
    expect(lyricsAtLimit('x'.repeat(textLimits.lyrics - 1))).toBe(false);
    expect(lyricsAtLimit('x'.repeat(textLimits.lyrics))).toBe(true);
    const { container } = render(<LyricsLimitNote text="One line\nAnother line" />);
    expect(container).toBeEmptyDOMElement();
  });
});
