import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LocalAudioUploader } from '../../components/track-search/LocalAudioUploader';

const song = () => new File(['audio'], 'Artist - Song.mp3', { type: 'audio/mpeg' });

function renderUploader() {
  render(<LocalAudioUploader isLoading={false} customLyrics="" onError={vi.fn()} />);
  return screen.getByLabelText(/choose local audio file/i) as HTMLInputElement;
}

// A browser's file input fires no change event when the file it already holds is picked
// again, so an input left holding the removed file makes "pick it again" do nothing.
describe('the file picker after its file is removed or replaced', () => {
  it('holds no file once Remove is pressed, so the same file can be picked again', async () => {
    const user = userEvent.setup();
    const input = renderUploader();

    await user.upload(input, song());
    expect(input.files).toHaveLength(1);
    expect(screen.getByText('Artist - Song.mp3')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remove selected audio file' }));

    expect(screen.queryByText('Artist - Song.mp3')).not.toBeInTheDocument();
    expect(input.files).toHaveLength(0);
    expect(input.value).toBe('');
  });

  it('holds no file once another one is dropped on the card', async () => {
    const user = userEvent.setup();
    const input = renderUploader();
    await user.upload(input, song());

    const dropped = new File(['audio'], 'Dropped.wav', { type: 'audio/wav' });
    fireEvent.drop(screen.getByText('Artist - Song.mp3'), { dataTransfer: { files: [dropped] } });

    expect(screen.getByText('Dropped.wav')).toBeInTheDocument();
    expect(input.files).toHaveLength(0);
  });
});
