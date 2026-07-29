export type BlockType =
  | "rich-text"
  | "image"
  | "table"
  | "shape"
  | "attachment"
  | "drawing";

export interface RichTextContent {
  html: string;
}

export interface AssetRef {
  id: string;
  filename: string;
  mimeType: string;
  dataUrl?: string;
}

interface BlockPlacement {
  id: string;
  type: BlockType;
  column: number;
  row: number;
  columnSpan: number;
  rowSpan: number;
}

export interface RichTextBlock extends BlockPlacement, RichTextContent {
  type: "rich-text";
}

export interface ImageBlock extends BlockPlacement {
  type: "image";
  assetId: string;
  alt: string;
}

export interface TableBlock extends BlockPlacement {
  type: "table";
  cells: string[][];
}

export interface ShapeBlock extends BlockPlacement {
  type: "shape";
  shape: "rounded" | "circle" | "note";
  color: string;
  text: string;
}

export interface AttachmentBlock extends BlockPlacement {
  type: "attachment";
  assetId: string;
  label: string;
}

export interface DrawingPoint {
  x: number;
  y: number;
}

export interface DrawingStroke {
  id: string;
  color: string;
  width: number;
  points: DrawingPoint[];
}

export interface DrawingBlock extends BlockPlacement {
  type: "drawing";
  strokes: DrawingStroke[];
}

export type GridBlock =
  | RichTextBlock
  | ImageBlock
  | TableBlock
  | ShapeBlock
  | AttachmentBlock
  | DrawingBlock;

export interface NotebookPage {
  id: string;
  title: string;
  blocks: GridBlock[];
}

export interface Notebook {
  id: string;
  title: string;
  activePageId: string;
  pages: NotebookPage[];
  assets: AssetRef[];
  updatedAt: string;
}
