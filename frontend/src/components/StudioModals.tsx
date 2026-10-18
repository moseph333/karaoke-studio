/**
 * Studio Modals Orchestration Component
 *
 * Hosts global and studio-scoped modal dialogs (Export, Authentication,
 * Help/Usage Guide, Project Deletion, and Metadata Editing).
 */

import React from 'react';
import { ExportModal } from './ExportModal';
import { AuthModal } from './AuthModal';
import { HelpModal } from './HelpModal';
import { DeleteConfirmModal } from './DeleteConfirmModal';
import { EditMetadataModal } from './EditMetadataModal';
import { ProjectState, VisualTheme } from '../types';

export interface StudioModalsProps {
  project: ProjectState | null;
  isExportOpen: boolean;
  onCloseExport: () => void;
  onCancelRender: () => void;
  onStartRender: () => void;
  selectedTheme: VisualTheme;
  aspectRatio: string;
  showAuthModal: boolean;
  onAuthSuccess: (username: string, token: string) => void;
  onCloseAuth: () => void;
  showHelpModal: boolean;
  onCloseHelp: () => void;
  showStudioDeleteModal: boolean;
  onCloseStudioDelete: () => void;
  onStudioProjectDeleted: () => void;
  showStudioEditModal: boolean;
  onCloseStudioEdit: () => void;
  onStudioMetadataSaved: (updated: { id: string; title: string; artist: string }) => void;
}

export const StudioModals: React.FC<StudioModalsProps> = ({
  project,
  isExportOpen,
  onCloseExport,
  onCancelRender,
  onStartRender,
  selectedTheme,
  aspectRatio,
  showAuthModal,
  onAuthSuccess,
  onCloseAuth,
  showHelpModal,
  onCloseHelp,
  showStudioDeleteModal,
  onCloseStudioDelete,
  onStudioProjectDeleted,
  showStudioEditModal,
  onCloseStudioEdit,
  onStudioMetadataSaved,
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
        />
      )}

      {/* Shared Studio Passphrase & Friend Profile Modal */}
      <AuthModal isOpen={showAuthModal} onSuccess={onAuthSuccess} onClose={onCloseAuth} />

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
    </>
  );
};
