import {
  CircleHelp,
  File,
  FilePen,
  FileText,
  Folder,
  Globe,
  ListTodo,
  Lock,
  Puzzle,
  Search,
  SquareTerminal,
  UserPlus,
  Zap,
  type LucideIcon
} from 'lucide-react';
import type { TimelineWorkRowGlyph } from '@zana-ai/zcc-thread-view';

const GLYPHS: Record<TimelineWorkRowGlyph, LucideIcon> = {
  CircleQuestion: CircleHelp,
  EditFile: FilePen,
  File,
  FileText,
  Folder,
  Globe,
  ListTodo,
  Lock,
  Puzzle,
  Search,
  Terminal: SquareTerminal,
  UserRoundPlus: UserPlus,
  Zap
};

export function TimelineWorkGlyph({ name }: { name: TimelineWorkRowGlyph }) {
  const Icon = GLYPHS[name];
  return <Icon size={14} className="thread-timeline-work-glyph" aria-hidden="true" />;
}
