/**
 * Re-export shim for ExportSubtitleSection.
 * Guarantees zero import ambiguity across root and subfolder paths.
 */
import { ExportSubtitleSection } from './export/ExportSubtitleSection';

export { ExportSubtitleSection };
export type { ExportSubtitleSectionProps } from './export/ExportSubtitleSection';
export default ExportSubtitleSection;
