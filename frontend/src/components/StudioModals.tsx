/**
 * Studio Modals Orchestration Component
 *
 * Hosts global and studio-scoped modal dialogs (Export, Authentication,
 * Help/Usage Guide, Project Deletion, Metadata Editing and stem re-separation).
 */

import React from 'react';
import { ExportModal } from './ExportModal';
import { AuthModal } from './AuthModal';
import { HelpModal } from './HelpModal';
import { DeleteConfirmModal } from './DeleteConfirmModal';
import { EditMetadataModal } from './EditMetadataModal';
import { ReseparateDialog } from './quality/ReseparateDialog';
import { ProjectState, VisualTheme, SyncDisplayMode } from '../types';
import type { UseQualityJobsReturn } from '../hooks/useQualityJobs';

export interface StudioModalsProps {
  project: ProjectState | null;
  isExportOpen: boolean;
  onCloseExport: () => void;
  onCancelRender: () => void;
  onStartRender: (options?: {
    includeVisualizer?: boolean;
    includeCountdown?: boolean;
    includeChords?: boolean;
    syncMode?: SyncDisplayMode;
  }) => void;
  selectedTheme: VisualTheme;
  aspectRatio: string;
  activeSemitones?: number;
  syncMode?: SyncDisplayMode;
  onSyncModeChange?: (mode: SyncDisplayMode) => void;
  primaryColor?: string;
  secondaryColor?: string;
  /** Duet colors and stage backdrop from the Look panel, so exports match the preview. */
  singer2Color?: string;
  bothColor?: string;
  backgroundColor?: string;
  fontSizeScale?: number;
  showAuthModal: boolean;
  onAuthSuccess: (username: string, token: string) => void;
  onCloseAuth?: () => void;
  /** Signed in already: the dialog switches profile and can be closed. */
  authDismissable?: boolean;
  /** The server checks a passphrase (APP_PASSWORD is set). */
  authRequiresPassword?: boolean;
  showHelpModal: boolean;
  onCloseHelp: () => void;
  showStudioDeleteModal: boolean;
  onCloseStudioDelete: () => void;
  onStudioProjectDeleted: () => void;
  showStudioEditModal: boolean;
  onCloseStudioEdit: () => void;
  onStudioMetadataSaved: (updated: { id: string; title: string; artist: string }) => void;
  /** Stem re-separation dialog state and actions. */
  quality?: UseQualityJobsReturn;
  hasUnsavedLyricEdits?: boolean;
}

export const StudioModals: React.FC<StudioModalsProps> = ({
  project,
  isExportOpen,
  onCloseExport,
  onCancelRender,
  onStartRender,
  selectedTheme,
  aspectRatio,
  activeSemitones,
  syncMode,
  onSyncModeChange,
  primaryColor,
  secondaryColor,
  singer2Color,
  bothColor,
  backgroundColor,
  fontSizeScale,
  showAuthModal,
  onAuthSuccess,
  onCloseAuth,
  authDismissable = false,
  authRequiresPassword = true,
  showHelpModal,
  onCloseHelp,
  showStudioDeleteModal,
  onCloseStudioDelete,
  onStudioProjectDeleted,
  showStudioEditModal,
  onCloseStudioEdit,
  onStudioMetadataSaved,
  quality,
  hasUnsavedLyricEdits = false,
}) => {
  return (
    <>
      {/* Export & YouTube Package Modal */}
      {project && (
        <ExportModal
          project={project}
          isOpen={isExportOpen}
          onClose={onCloseExport}
          onCancelRender={onCancelRender}
          onStartRender={onStartRender}
          selectedTheme={selectedTheme}
          aspectRatio={aspectRatio}
          activeSemitones={activeSemitones}
          syncMode={syncMode}
          onSyncModeChange={onSyncModeChange}
          primaryColor={primaryColor}
          secondaryColor={secondaryColor}
          singer2Color={singer2Color}
          bothColor={bothColor}
          backgroundColor={backgroundColor}
          fontSizeScale={fontSizeScale}
        />
      )}

      {/* Shared Studio Passphrase & Friend Profile Modal */}
      <AuthModal
        isOpen={showAuthModal}
        onSuccess={onAuthSuccess}
        onClose={onCloseAuth}
        dismissable={authDismissable}
        requirePassword={authRequiresPassword}
      />

      {/* Help & Usage Guide Modal */}
      <HelpModal isOpen={showHelpModal} onClose={onCloseHelp} />

      {/* Studio Project Delete Modal */}
      <DeleteConfirmModal
        isOpen={showStudioDeleteModal}
        projectId={project?.id || ''}
        projectTitle={project?.title || ''}
        projectArtist={project?.artist}
        onClose={onCloseStudioDelete}
        onDeleted={onStudioProjectDeleted}
      />

      {/* Studio Edit Metadata Modal */}
      <EditMetadataModal
        isOpen={showStudioEditModal}
        project={
          project
            ? {
                id: project.id,
                title: project.title || '',
                artist: project.artist || '',
              }
            : null
        }
        onClose={onCloseStudioEdit}
        onSaved={onStudioMetadataSaved}
      />

      {/* Re-make the stems at another quality */}
      {project && quality && (
        <ReseparateDialog
          isOpen={quality.isReseparateOpen}
          onClose={quality.closeReseparate}
          project={project}
          hasUnsavedLyricEdits={hasUnsavedLyricEdits}
          onSubmit={quality.startReseparation}
        />
      )}
    </>
  );
};
