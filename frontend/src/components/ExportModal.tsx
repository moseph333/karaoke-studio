import React, { useState } from 'react';
import { Download, Copy, Check, ExternalLink, X, Film, Sparkles, Youtube } from 'lucide-react';
import { ProjectState } from '../types';

interface ExportModalProps {
  project: ProjectState;
  isOpen: boolean;
  onClose: () => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({ project, isOpen, onClose }) => {
  const [copiedField, setCopiedField] = useState<string | null>(null);

  if (!isOpen) return null;

  const isRendering = project.render_status === 'queued' || project.render_status === 'rendering';
  const isCompleted = project.render_status === 'completed';
  const isError = project.render_status === 'error';

  const copyToClipboard = (text: string, fieldName: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldName);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const yt = project.youtube_package;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-3xl w-full max-h-[90vh] overflow-y-auto shadow-2xl p-6 relative">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-5 right-5 p-2 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-800">
          <div className="p-2.5 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/30">
            <Film className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">Export & YouTube Package</h2>
            <p className="text-xs text-slate-400">
              {project.title} • {project.artist}
            </p>
          </div>
        </div>

        {/* 1. Rendering In-Progress State */}
        {isRendering && (
          <div className="py-12 text-center space-y-4">
            <div className="w-16 h-16 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
            <h3 className="text-lg font-bold text-white">Rendering High-Definition Karaoke Video...</h3>
            <p className="text-xs text-slate-400 max-w-md mx-auto">
              Synthesizing word-by-word progressive wipe subtitles, ambient visuals, and master audio with FFmpeg.
            </p>
            <div className="w-72 bg-slate-800 h-2.5 rounded-full mx-auto overflow-hidden">
              <div
                className="bg-gradient-to-r from-cyan-500 to-blue-500 h-full transition-all duration-500"
                style={{ width: `${project.render_progress || 30}%` }}
              ></div>
            </div>
            <p className="text-xs font-mono text-cyan-400">{project.render_progress || 30}% Completed</p>
          </div>
        )}

        {/* 2. Error State */}
        {isError && (
          <div className="p-6 bg-red-950/40 border border-red-800/60 rounded-2xl text-center space-y-3">
            <h3 className="text-base font-bold text-red-400">Rendering Encountered an Error</h3>
            <p className="text-xs text-red-300 font-mono">{project.render_error || 'Unknown rendering error'}</p>
          </div>
        )}

        {/* 3. Completed State: Video Player + YouTube Kit */}
        {isCompleted && (
          <div className="space-y-6">
            {/* Video Player */}
            {project.video_url && (
              <div className="aspect-video w-full rounded-2xl overflow-hidden bg-black border border-slate-800 shadow-xl">
                <video
                  src={project.video_url}
                  controls
                  className="w-full h-full object-contain"
                />
              </div>
            )}

            {/* Download Buttons */}
            <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-slate-950/70 border border-slate-800 rounded-2xl">
              <div>
                <h4 className="text-sm font-bold text-white">Your Video Is Ready!</h4>
                <p className="text-xs text-slate-400">High-bitrate 1080p60 MP4 with AAC 320kbps stereo audio.</p>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={project.video_url}
                  download={`${project.artist || 'Karaoke'} - ${project.title || 'Track'}.mp4`}
                  className="px-5 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-sm transition-all shadow-lg shadow-cyan-500/20 flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  Download Video (.mp4)
                </a>
                <a
                  href="https://studio.youtube.com"
                  target="_blank"
                  rel="noreferrer"
                  className="px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-medium text-sm transition-all flex items-center gap-1.5 shadow-md shadow-red-600/20"
                >
                  <Youtube className="w-4 h-4" />
                  Open YouTube Studio
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>

            {/* YouTube Ready-To-Copy Metadata Kit */}
            {yt && (
              <div className="space-y-4 pt-2">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-cyan-400" />
                  <h4 className="text-sm font-bold text-white uppercase tracking-wider">
                    YouTube Metadata & Upload Kit
                  </h4>
                </div>

                {/* Title */}
                <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-semibold text-slate-400">Video Title</span>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(yt.title, 'title')}
                      className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1 font-medium"
                    >
                      {copiedField === 'title' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      {copiedField === 'title' ? 'Copied!' : 'Copy Title'}
                    </button>
                  </div>
                  <p className="text-sm font-medium text-white">{yt.title}</p>
                </div>

                {/* Description */}
                <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-semibold text-slate-400">Description (with Chapters & Lyrics)</span>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(yt.description, 'description')}
                      className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1 font-medium"
                    >
                      {copiedField === 'description' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      {copiedField === 'description' ? 'Copied!' : 'Copy Description'}
                    </button>
                  </div>
                  <pre className="text-xs font-mono text-slate-300 whitespace-pre-wrap max-h-36 overflow-y-auto bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/80">
                    {yt.description}
                  </pre>
                </div>

                {/* Tags */}
                <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-semibold text-slate-400">SEO Tags (comma-separated)</span>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(yt.tags.join(', '), 'tags')}
                      className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1 font-medium"
                    >
                      {copiedField === 'tags' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      {copiedField === 'tags' ? 'Copied!' : 'Copy Tags'}
                    </button>
                  </div>
                  <p className="text-xs text-slate-300 font-mono">{yt.tags.join(', ')}</p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
