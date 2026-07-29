"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

type Mixed<T> = T | "mixed";

export type TextFormatState = {
  hasSelection: boolean;
  font: Mixed<"system-ui" | "Arial" | "Georgia" | "Courier New">;
  size: Mixed<"1" | "2" | "3" | "4" | "5">;
  block: Mixed<"p" | "h1" | "h2" | "h3">;
  bold: Mixed<boolean>;
  italic: Mixed<boolean>;
  list: Mixed<boolean>;
  link: Mixed<boolean>;
};

export const emptyTextFormat: TextFormatState = {
  hasSelection: false,
  font: "system-ui",
  size: "2",
  block: "p",
  bold: false,
  italic: false,
  list: false,
  link: false,
};

type RichTextEditorProps = {
  blockId: string;
  html: string;
  onSave: (html: string) => void;
  onSelectionChange: (editor: HTMLElement) => void;
  onFormatChange: (format: TextFormatState) => void;
};

function shared<T>(values: T[]): Mixed<T> {
  return values.every((value) => value === values[0]) ? values[0] : "mixed";
}

function selectedElements(editor: HTMLElement) {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return [];
  const range = selection.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) return [];
  if (range.collapsed) {
    const node = selection.anchorNode;
    const element =
      node?.nodeType === Node.ELEMENT_NODE
        ? (node as Element)
        : node?.parentElement;
    return element ? [element] : [editor];
  }
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  const elements: Element[] = [];
  let node = walker.nextNode();
  while (node) {
    if (node.textContent?.trim() && range.intersectsNode(node)) {
      const element = node.parentElement;
      if (element && !elements.includes(element)) elements.push(element);
    }
    node = walker.nextNode();
  }
  return elements.length ? elements : [editor];
}

function ownsSelection(editor: HTMLElement) {
  const selection = window.getSelection();
  return Boolean(
    selection?.rangeCount &&
      editor.contains(selection.getRangeAt(0).commonAncestorContainer),
  );
}

function fontValue(fontFamily: string): TextFormatState["font"] {
  const font = fontFamily.toLowerCase();
  if (font.includes("courier") || font.includes("monospace")) {
    return "Courier New";
  }
  if (font.includes("georgia")) return "Georgia";
  if (font.includes("arial")) return "Arial";
  return "system-ui";
}

function sizeValue(fontSize: string): TextFormatState["size"] {
  const pixels = Number.parseFloat(fontSize);
  if (pixels <= 11) return "1";
  if (pixels <= 14) return "2";
  if (pixels <= 17) return "3";
  if (pixels <= 21) return "4";
  return "5";
}

function blockValue(element: Element): "p" | "h1" | "h2" | "h3" {
  const block = element.closest("h1,h2,h3,p");
  const tag = block?.tagName.toLowerCase();
  return tag === "h1" || tag === "h2" || tag === "h3" ? tag : "p";
}

function readFormat(editor: HTMLElement): TextFormatState {
  const elements = selectedElements(editor);
  if (!elements.length) return emptyTextFormat;
  const styles = elements.map((element) => getComputedStyle(element));
  return {
    hasSelection: !window.getSelection()?.isCollapsed,
    font: shared(styles.map((style) => fontValue(style.fontFamily))),
    size: shared(styles.map((style) => sizeValue(style.fontSize))),
    block: shared(elements.map(blockValue)),
    bold: shared(
      styles.map(
        (style) =>
          style.fontWeight === "bold" ||
          Number.parseInt(style.fontWeight, 10) >= 600,
      ),
    ),
    italic: shared(styles.map((style) => style.fontStyle === "italic")),
    list: shared(elements.map((element) => Boolean(element.closest("li")))),
    link: shared(elements.map((element) => Boolean(element.closest("a")))),
  };
}

export function RichTextEditor({
  blockId,
  html,
  onSave,
  onSelectionChange,
  onFormatChange,
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (editor && editor.innerHTML !== html) {
      editor.innerHTML = html;
    }
  }, [blockId, html]);

  useEffect(() => {
    const update = () => {
      const editor = editorRef.current;
      if (editor && ownsSelection(editor)) onFormatChange(readFormat(editor));
    };
    document.addEventListener("selectionchange", update);
    return () => document.removeEventListener("selectionchange", update);
  }, [onFormatChange]);

  const updateSelection = (editor: HTMLElement) => {
    onSelectionChange(editor);
    onFormatChange(readFormat(editor));
  };

  return (
    <div
      ref={editorRef}
      className="rich-editor"
      data-editor-id={blockId}
      contentEditable
      suppressContentEditableWarning
      spellCheck
      onBlur={(event) => onSave(event.currentTarget.innerHTML)}
      onInput={(event) => updateSelection(event.currentTarget)}
      onSelect={(event) => updateSelection(event.currentTarget)}
      onKeyUp={(event) => updateSelection(event.currentTarget)}
      onPointerUp={(event) => updateSelection(event.currentTarget)}
    />
  );
}
