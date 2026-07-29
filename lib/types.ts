export type BlockType = "rich-text" | "image";

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

export type GridBlock = RichTextBlock | ImageBlock;

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
