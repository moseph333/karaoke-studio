/**
 * Studio Modals Orchestration Component
 *
 * Hosts global and studio-scoped modal dialogs (Export, Authentication,
 * Help/Usage Guide, Project Deletion, Metadata Editing, stem re-separation and the song
 * check-up).
 */

import React, { Suspense, useState } from 'react';
import { AuthModal } from './AuthModal';
import { DeleteConfirmModal } from './DeleteConfirmModal';
import { ErrorBoundary } from './ErrorBoundary';
import { EditMetadataModal, type EditedMetadata } from './EditMetadataModal';
import { ExportModal, HelpModal, ReseparateDialog, SongCheckupDialog } from '../deferredScreens';
import { ProjectState, VisualTheme, SyncDisplayMode } from '../types';
import type { UseQualityJobsReturn } from '../hooks/useQualityJobs';
import type { GuideAction } from '../utils/guideActions';

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
  onStudioMetadataSaved: (updated: EditedMetadata) => void;
  /** Stem re-separation dialog state and actions. */
  quality?: UseQualityJobsReturn;
  hasUnsavedLyricEdits?: boolean;
  /** The song check-up and what its buttons do. */
  showCheckup?: boolean;
  onCloseCheckup?: () => void;
  onGuideAction?: (action: GuideAction) => void;
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
  showCheckup = false,
  onCloseCheckup,
  onGuideAction,
}) => {
  // The export, help, stem and check-up dialogs are deferred chunks (see deferredScreens.ts). Each is
  // mounted from the first time it is opened, so a closed dialog fetches nothing.
  const [exportOpened, setExportOpened] = useState(isExportOpen);
  if (isExportOpen && !exportOpened) setExportOpened(true);
  const [helpOpened, setHelpOpened] = useState(showHelpModal);
  if (showHelpModal && !helpOpened) setHelpOpened(true);
  const isReseparateOpen = Boolean(quality?.isReseparateOpen);
  const [reseparateOpened, setReseparateOpened] = useState(isReseparateOpen);
  if (isReseparateOpen && !reseparateOpened) setReseparateOpened(true);
  const [checkupOpened, setCheckupOpened] = useState(showCheckup);
  if (showCheckup && !checkupOpened) setCheckupOpened(true);

  return (
    <Suspense fallback={null}>
      {/* Export & YouTube Package Modal */}
      {project && exportOpened && (
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
      {/* A help chunk that cannot load (an update replaced the build) closes the dialog
          instead of taking the studio, and any unsaved edits, down with it */}
      {helpOpened && (
        <ErrorBoundary fallback={() => null} resetKey={showHelpModal} onError={onCloseHelp}>
          <HelpModal isOpen={showHelpModal} onClose={onCloseHelp} />
        </ErrorBoundary>
      )}

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
                part_names: project.part_names ?? {},
              }
            : null
        }
        onClose={onCloseStudioEdit}
        onSaved={onStudioMetadataSaved}
      />

      {/* Re-make the stems at another quality */}
      {project && quality && reseparateOpened && (
        <ReseparateDialog
          isOpen={quality.isReseparateOpen}
          onClose={quality.closeReseparate}
          project={project}
          hasUnsavedLyricEdits={hasUnsavedLyricEdits}
          onSubmit={quality.startReseparation}
        />
      )}

      {/* What looks off about the open song, and the tool that fixes each thing */}
      {project && checkupOpened && onCloseCheckup && onGuideAction && (
        <SongCheckupDialog
          isOpen={showCheckup && project.status === 'ready'}
          onClose={onCloseCheckup}
          project={project}
          onAction={onGuideAction}
        />
      )}
    </Suspense>
  );
};
