export type BlockType = "rich-text";

export interface RichTextContent {
  html: string;
}

export interface AssetRef {
  id: string;
  filename: string;
  mimeType: string;
}

export interface GridBlock extends RichTextContent {
  id: string;
  type: BlockType;
  column: number;
  row: number;
  columnSpan: number;
  rowSpan: number;
}

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
