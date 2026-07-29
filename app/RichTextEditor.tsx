"use client";

import { useLayoutEffect, useRef } from "react";

type RichTextEditorProps = {
  blockId: string;
  html: string;
  onSave: (html: string) => void;
  onSelectionChange: (editor: HTMLElement) => void;
};

export function RichTextEditor({
  blockId,
  html,
  onSave,
  onSelectionChange,
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (editor && editor.innerHTML !== html) {
      editor.innerHTML = html;
    }
  }, [blockId, html]);

  return (
    <div
      ref={editorRef}
      className="rich-editor"
      data-editor-id={blockId}
      contentEditable
      suppressContentEditableWarning
      spellCheck
      onBlur={(event) => onSave(event.currentTarget.innerHTML)}
      onInput={(event) => onSelectionChange(event.currentTarget)}
      onSelect={(event) => onSelectionChange(event.currentTarget)}
      onKeyUp={(event) => onSelectionChange(event.currentTarget)}
      onPointerUp={(event) => onSelectionChange(event.currentTarget)}
    />
  );
}
