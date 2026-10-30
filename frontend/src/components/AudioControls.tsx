/**
 * Audio Controls Component (Mix inspector)
 *
 * Key transposition with the Smart Key Recommender, guide vocal blend, the instrumental
 * source and, when the app wires it, which model made the stems (with a way to re-make
 * them). Playback itself lives in the TransportDock.
 *
 * Works controlled (App passes `semitones` / `guideVolume` from useMixController) or
 * standalone, where it keeps its own state and applies changes through `onMixChange`
 * after a short debounce.
 */

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { apiFetch } from '../api';
import { useToast } from '../hooks/useToast';
import { MASTER_VOLUME_STORAGE_KEY, MASTER_MUTED_STORAGE_KEY } from '../utils/volumeStorage';
import { parseMediaError, type AudioPlaybackError } from '../utils/audioErrors';
import { PitchTranspositionControl } from './audio/PitchTranspositionControl';
import { GuideVocalControl } from './audio/GuideVocalControl';
import { AudioMixActionsBar } from './audio/AudioMixActionsBar';
import { VocalRangeRecommenderModal } from './audio/VocalRangeRecommenderModal';
import { StemQualityControl } from './quality/StemQualityControl';
import { Panel } from './ui/Panel';
import { SeparationInfo, SeparationJob, VocalRangeData } from '../types';
import { formatSemitones } from '../utils/format';

export { MASTER_VOLUME_STORAGE_KEY, MASTER_MUTED_STORAGE_KEY };
export { parseMediaError, type AudioPlaybackError };

const SEMITONE_LIMIT = 12;
const GUIDE_LIMIT = 0.5;
const STANDALONE_DEBOUNCE_MS = 500;

const clampSemitones = (n: number) =>
  Math.max(-SEMITONE_LIMIT, Math.min(SEMITONE_LIMIT, Math.round(Number.isFinite(n) ? n : 0)));

export interface AudioControlsProps {
  projectId: string;
  instrumentalUrl?: string;
  vocalsUrl?: string;
  /** Controlled key offset (requested, not necessarily applied yet). */
  semitones?: number;
  /** Controlled guide vocal level (0-0.5). */
  guideVolume?: number;
  onSemitonesChange?: (semitones: number) => void;
  onGuideVolumeChange?: (volume: number) => void;
  /** Fires when the guide slider is released. */
  onGuideVolumeCommit?: (volume: number) => void;
  /** True while the master mix is being re-rendered. */
  isRemixing?: boolean;
  /** True while a requested change waits for its debounced apply. */
  isMixPending?: boolean;
  /** Re-render the master mix now (used after replacing the instrumental). */
  onRequestRemix?: () => void;
  /** Standalone mode: initial values and the debounced apply callback. */
  initialSemitones?: number;
  initialGuideVolume?: number;
  onMixChange?: (semitones: number, guideVolume: number) => void | Promise<void>;
  mixDebounceMs?: number;
  onCustomInstrumentalUploaded?: (url: string) => void;
  // Vocal range & Smart key recommender
  vocalRange?: VocalRangeData | null;
  onAnalyzeVocalRange?: () => void | Promise<void>;
  isAnalyzingRange?: boolean;
  /** Stems: how they were made, and re-making them (shown when onImproveStems is set). */
  separation?: SeparationInfo | null;
  separationJob?: SeparationJob | null;
  onImproveStems?: () => void;
  onCancelReseparation?: () => void;
  /** Why the stems cannot be re-made right now, if another job is busy. */
  stemsBusyReason?: string | null;
  className?: string;
}

export const AudioControls: React.FC<AudioControlsProps> = ({
  projectId,
  instrumentalUrl,
  semitones: semitonesProp,
  guideVolume: guideVolumeProp,
  onSemitonesChange,
  onGuideVolumeChange,
  onGuideVolumeCommit,
  isRemixing: isRemixingProp,
  isMixPending,
  onRequestRemix,
  initialSemitones = 0,
  initialGuideVolume = 0.0,
  onMixChange,
  mixDebounceMs = STANDALONE_DEBOUNCE_MS,
  onCustomInstrumentalUploaded,
  vocalRange: propVocalRange,
  onAnalyzeVocalRange: propOnAnalyze,
  isAnalyzingRange: propIsAnalyzing,
  separation,
  separationJob,
  onImproveStems,
  onCancelReseparation,
  stemsBusyReason,
  className,
}) => {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingInst, setUploadingInst] = useState(false);

  // Standalone state (ignored when the matching prop is controlled)
  const [localSemitones, setLocalSemitones] = useState(() => clampSemitones(initialSemitones));
  const [localGuide, setLocalGuide] = useState(initialGuideVolume);
  const [isApplyingLocal, setIsApplyingLocal] = useState(false);
  const isSemitonesControlled = semitonesProp !== undefined;
  const isGuideControlled = guideVolumeProp !== undefined;
  const semitones = isSemitonesControlled ? clampSemitones(semitonesProp) : localSemitones;
  const guideVolume = isGuideControlled ? guideVolumeProp : localGuide;
  const isRemixing = isRemixingProp ?? isApplyingLocal;

  useEffect(() => {
    setLocalSemitones(clampSemitones(initialSemitones));
  }, [initialSemitones, projectId]);

  useEffect(() => {
    setLocalGuide(initialGuideVolume);
  }, [initialGuideVolume, projectId]);

  // Debounced standalone apply through onMixChange
  const latestRef = useRef({ semitones, guideVolume });
  latestRef.current = { semitones, guideVolume };
  const applyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onMixChangeRef = useRef(onMixChange);
  onMixChangeRef.current = onMixChange;

  useEffect(
    () => () => {
      if (applyTimerRef.current) clearTimeout(applyTimerRef.current);
    },
    []
  );

  const scheduleStandaloneApply = useCallback(() => {
    if (!onMixChangeRef.current) return;
    if (applyTimerRef.current) clearTimeout(applyTimerRef.current);
    applyTimerRef.current = setTimeout(async () => {
      applyTimerRef.current = null;
      const apply = onMixChangeRef.current;
      if (!apply) return;
      setIsApplyingLocal(true);
      try {
        await apply(latestRef.current.semitones, latestRef.current.guideVolume);
      } catch (err) {
        console.error('Failed to apply audio mix:', err);
        toast.error('Failed to apply audio mix.');
      } finally {
        setIsApplyingLocal(false);
      }
    }, mixDebounceMs);
  }, [mixDebounceMs, toast]);

  const updateSemitones = (next: number) => {
    const clamped = clampSemitones(next);
    if (!isSemitonesControlled) {
      setLocalSemitones(clamped);
      latestRef.current = { ...latestRef.current, semitones: clamped };
      scheduleStandaloneApply();
    }
    onSemitonesChange?.(clamped);
  };

  const updateGuide = (next: number) => {
    const clamped = Math.max(0, Math.min(GUIDE_LIMIT, next));
    if (!isGuideControlled) setLocalGuide(clamped);
    onGuideVolumeChange?.(clamped);
  };

  const commitGuide = (next: number) => {
    const clamped = Math.max(0, Math.min(GUIDE_LIMIT, next));
    if (!isGuideControlled) {
      latestRef.current = { ...latestRef.current, guideVolume: clamped };
      scheduleStandaloneApply();
    }
    onGuideVolumeCommit?.(clamped);
  };

  // Vocal Range Recommender & Analysis State
  const [isRecommenderOpen, setIsRecommenderOpen] = useState(false);
  const [internalVocalRange, setInternalVocalRange] = useState<VocalRangeData | null>(
    propVocalRange ?? null
  );
  const [internalIsAnalyzing, setInternalIsAnalyzing] = useState(false);

  useEffect(() => {
    if (propVocalRange !== undefined) setInternalVocalRange(propVocalRange);
  }, [propVocalRange]);

  const activeVocalRange = propVocalRange !== undefined ? propVocalRange : internalVocalRange;
  const activeIsAnalyzing = propIsAnalyzing !== undefined ? propIsAnalyzing : internalIsAnalyzing;

  const handleAnalyzeVocalRange = useCallback(async () => {
    if (propOnAnalyze) {
      await propOnAnalyze();
      return;
    }
    if (!projectId) return;
    setInternalIsAnalyzing(true);
    try {
      const res = await apiFetch(`/api/project/${projectId}/vocal-range`, { method: 'POST' });
      if (!res.ok) throw new Error('Vocal range analysis failed');
      const data: VocalRangeData = await res.json();
      setInternalVocalRange(data);
      toast.success('Vocal range analysis complete');
    } catch (err) {
      console.error('Error analyzing vocal range:', err);
      toast.error('Could not analyze vocal range.');
    } finally {
      setInternalIsAnalyzing(false);
    }
  }, [propOnAnalyze, projectId, toast]);

  const handleApplyTransposition = (newSemitones: number) => {
    const clamped = clampSemitones(newSemitones);
    updateSemitones(clamped);
    toast.success(`Key set to ${formatSemitones(clamped, 'the original key')}`);
  };

  const requestRemix = () => {
    if (onRequestRemix) {
      onRequestRemix();
    } else if (onMixChangeRef.current) {
      scheduleStandaloneApply();
    }
  };

  const handleInstrumentalUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingInst(true);
    const formData = new FormData();
    formData.append('project_id', projectId);
    formData.append('file', file);

    try {
      const res = await apiFetch('/api/upload-instrumental', {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) throw new Error('Upload failed');
      const data = await res.json();
      if (onCustomInstrumentalUploaded && data.instrumental_url) {
        onCustomInstrumentalUploaded(data.instrumental_url);
        toast.success('Custom instrumental uploaded successfully');
      }
      requestRemix();
    } catch (err) {
      console.error('Error uploading instrumental:', err);
      toast.error('Could not upload instrumental file.');
    } finally {
      setUploadingInst(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <Panel
      headingLevel={2}
      title="Audio mix"
      description="Changes apply automatically"
      icon={<SlidersHorizontal className="h-4 w-4" />}
      className={className}
      data-testid="audio-mix-panel"
    >
      <div className="flex flex-col gap-5">
        <PitchTranspositionControl
          semitones={semitones}
          onSemitoneChange={(delta) => updateSemitones(semitones + delta)}
          onResetPitch={() => updateSemitones(0)}
          vocalRange={activeVocalRange}
          onOpenRecommender={() => setIsRecommenderOpen(true)}
          onAnalyzeVocalRange={handleAnalyzeVocalRange}
          isAnalyzingRange={activeIsAnalyzing}
          isMixPending={isMixPending ?? false}
          isRemixing={isRemixing}
        />

        <GuideVocalControl
          guideVolume={guideVolume}
          onGuideVolumeChange={updateGuide}
          onGuideVolumeCommit={commitGuide}
        />

        <AudioMixActionsBar
          uploadingInst={uploadingInst}
          fileInputRef={fileInputRef}
          onInstrumentalUpload={handleInstrumentalUpload}
          isCustomInstrumental={Boolean(instrumentalUrl && instrumentalUrl.includes('custom_inst'))}
        />

        {onImproveStems && (
          <StemQualityControl
            separation={separation}
            job={separationJob}
            onImprove={onImproveStems}
            onCancel={onCancelReseparation}
            busyReason={stemsBusyReason}
          />
        )}
      </div>

      <VocalRangeRecommenderModal
        isOpen={isRecommenderOpen}
        onClose={() => setIsRecommenderOpen(false)}
        vocalRange={activeVocalRange}
        currentSemitones={semitones}
        onApplyTransposition={handleApplyTransposition}
        onAnalyzeVocalRange={handleAnalyzeVocalRange}
        isAnalyzing={activeIsAnalyzing}
      />
    </Panel>
  );
};
