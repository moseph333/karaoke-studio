/**
 * Everything that only an open song needs (the studio workspace, the transport dock, the
 * export and stem dialogs), re-exported from one module so it builds into one chunk that
 * deferredScreens.ts loads on demand.
 */

export { StudioWorkspace } from './StudioWorkspace';
export { TransportDock } from '../transport/TransportDock';
export { ExportModal } from '../ExportModal';
export { ReseparateDialog } from '../quality/ReseparateDialog';
