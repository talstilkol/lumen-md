/**
 * The icons the command list uses (W10.E19): their own module, so the
 * command domains import them without loading the command palette, which
 * is lazy (it loads on first open).
 */
import {
  FileText,
  FolderOpen,
  Save,
  Sun,
  Moon,
  Eye,
  Pencil,
  Columns2,
  Sparkles,
  BarChart3,
  Map,
  Network,
  Table,
  Calculator,
  Quote,
  Download,
  PanelRightOpen,
  Printer,
  Music2,
  Box,
  Workflow,
  Link,
  SquarePlay as Youtube,
} from "lucide-react";
import { dirIcon } from "./icons/direction";

export const cmdIcons = {
  FileText,
  FolderOpen,
  Save,
  Sun,
  Moon,
  Eye,
  Pencil,
  Columns2,
  Sparkles,
  BarChart3,
  Map,
  Network,
  Table,
  Calculator,
  Quote: dirIcon(Quote),
  Download,
  PanelRightOpen: dirIcon(PanelRightOpen),
  Printer,
  Music2,
  Box,
  Workflow,
  Link,
  Youtube,
};
