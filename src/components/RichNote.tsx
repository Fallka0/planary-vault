"use client";

import { Extension } from "@tiptap/core";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import { Placeholder } from "@tiptap/extensions";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { useEffect, useRef } from "react";
import StarterKit from "@tiptap/starter-kit";
import { NOTE_MIME } from "@/lib/format";

/**
 * Formatted notes: an editor with a small Word-like toolbar. Notes are stored as a standalone
 * HTML file (it opens in any browser once downloaded), encrypted like any file. Whatever is
 * loaded goes through the editor's schema, and fonts and sizes only come from the lists below,
 * so a note someone shares can't bring its own markup or CSS along.
 */

export { NOTE_MIME };

export const FONTS = {
  sans: { label: "Sans", css: "Manrope, -apple-system, 'Segoe UI', sans-serif" },
  serif: { label: "Serif", css: "Georgia, 'Times New Roman', serif" },
  mono: { label: "Mono", css: "ui-monospace, Menlo, Consolas, monospace" },
  display: { label: "Display", css: "Unbounded, sans-serif" },
} as const;
type FontKey = keyof typeof FONTS;

export const SIZES = ["12", "14", "16", "18", "24", "32"] as const;
type Size = (typeof SIZES)[number];

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    noteStyle: {
      setNoteFont: (font: FontKey | null) => ReturnType;
      setNoteSize: (size: Size | null) => ReturnType;
    };
  }
}

const fontOf = (el: HTMLElement) => {
  const css = el.style.fontFamily.replace(/["']/g, "").toLowerCase();
  if (!css) return null;
  return (Object.keys(FONTS) as FontKey[]).find((k) => css.startsWith(FONTS[k].css.split(",")[0].replace(/'/g, "").toLowerCase())) ?? null;
};
const sizeOf = (el: HTMLElement) => {
  const px = el.style.fontSize.replace(/px$/, "");
  return (SIZES as readonly string[]).includes(px) ? px : null;
};

/** Font and size on text, from the lists above only. */
const NoteStyle = Extension.create({
  name: "noteStyle",
  addGlobalAttributes() {
    return [
      {
        types: ["textStyle"],
        attributes: {
          noteFont: {
            default: null,
            parseHTML: fontOf,
            renderHTML: (a) => (a.noteFont && a.noteFont in FONTS ? { style: `font-family: ${FONTS[a.noteFont as FontKey].css}` } : {}),
          },
          noteSize: {
            default: null,
            parseHTML: sizeOf,
            renderHTML: (a) => ((SIZES as readonly string[]).includes(a.noteSize) ? { style: `font-size: ${a.noteSize}px` } : {}),
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setNoteFont:
        (font) =>
        ({ chain }) =>
          chain().setMark("textStyle", { noteFont: font }).removeEmptyTextStyle().run(),
      setNoteSize:
        (size) =>
        ({ chain }) =>
          chain().setMark("textStyle", { noteSize: size }).removeEmptyTextStyle().run(),
    };
  },
});

const EXTENSIONS = [
  StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: false, codeBlock: false }),
  TextStyle,
  NoteStyle,
  TaskList,
  TaskItem.configure({ nested: true }),
  TextAlign.configure({ types: ["heading", "paragraph"] }),
  Placeholder.configure({ placeholder: "Write something. Only you can read it." }),
];

/** The body of a stored note (a whole HTML page, or a fragment). */
export function noteBody(html: string) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return doc.body.innerHTML;
}

/** A standalone page around the editor's HTML, readable in any browser after download. */
export function notePage(title: string, body: string) {
  const esc = title.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="generator" content="Planary Vault">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc}</title>
<style>body{max-width:720px;margin:48px auto;padding:0 24px;font:16px/1.7 ${FONTS.sans.css};color:#111}ul[data-type=taskList]{list-style:none;padding-left:4px}ul[data-type=taskList] li{display:flex;gap:8px}</style>
</head><body>${body}</body></html>
`;
}

const Ico = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

function Btn({ on, label, onClick, children, disabled }: { on?: boolean; label: string; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      className={`tb-btn${on ? " is-on" : ""}`}
      aria-label={label}
      title={label}
      aria-pressed={on}
      disabled={disabled}
      // Keep the selection in the editor while clicking the toolbar.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      block: e.isActive("heading", { level: 1 }) ? "h1" : e.isActive("heading", { level: 2 }) ? "h2" : e.isActive("heading", { level: 3 }) ? "h3" : "p",
      font: (e.getAttributes("textStyle").noteFont as string | null) ?? "",
      size: (e.getAttributes("textStyle").noteSize as string | null) ?? "",
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      task: e.isActive("taskList"),
      align: e.isActive({ textAlign: "center" }) ? "center" : e.isActive({ textAlign: "right" }) ? "right" : "left",
      undo: e.can().undo(),
      redo: e.can().redo(),
    }),
  });
  const c = () => editor.chain().focus();
  return (
    <div className="note-tb" role="toolbar" aria-label="Formatting">
      <Btn label="Undo" disabled={!s.undo} onClick={() => c().undo().run()}>
        <Ico d="M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3" />
      </Btn>
      <Btn label="Redo" disabled={!s.redo} onClick={() => c().redo().run()}>
        <Ico d="m15 14 5-5-5-5M20 9H9a5 5 0 0 0 0 10h3" />
      </Btn>
      <span className="tb-sep" aria-hidden="true" />
      <select
        className="tb-sel"
        aria-label="Paragraph style"
        value={s.block}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "p") c().setParagraph().run();
          else c().setHeading({ level: Number(v[1]) as 1 | 2 | 3 }).run();
        }}
      >
        <option value="p">Text</option>
        <option value="h1">Title</option>
        <option value="h2">Heading</option>
        <option value="h3">Subheading</option>
      </select>
      <select className="tb-sel" aria-label="Font" value={s.font} onChange={(e) => c().setNoteFont((e.target.value || null) as FontKey | null).run()}>
        <option value="">Font</option>
        {(Object.keys(FONTS) as FontKey[]).map((k) => (
          <option key={k} value={k}>
            {FONTS[k].label}
          </option>
        ))}
      </select>
      <select className="tb-sel tb-size" aria-label="Size" value={s.size} onChange={(e) => c().setNoteSize((e.target.value || null) as Size | null).run()}>
        <option value="">Size</option>
        {SIZES.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
      <span className="tb-sep" aria-hidden="true" />
      <Btn label="Bold" on={s.bold} onClick={() => c().toggleBold().run()}>
        <b>B</b>
      </Btn>
      <Btn label="Italic" on={s.italic} onClick={() => c().toggleItalic().run()}>
        <i style={{ fontFamily: "Georgia, serif" }}>I</i>
      </Btn>
      <Btn label="Underline" on={s.underline} onClick={() => c().toggleUnderline().run()}>
        <u>U</u>
      </Btn>
      <Btn label="Strikethrough" on={s.strike} onClick={() => c().toggleStrike().run()}>
        <s>S</s>
      </Btn>
      <span className="tb-sep" aria-hidden="true" />
      <Btn label="Bulleted list" on={s.bullet} onClick={() => c().toggleBulletList().run()}>
        <Ico d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />
      </Btn>
      <Btn label="Numbered list" on={s.ordered} onClick={() => c().toggleOrderedList().run()}>
        <Ico d="M10 6h10M10 12h10M10 18h10M4 5h1v4M4 9h2M4 15.5c0-.8.7-1.5 1.5-1.5s1.5.6 1.5 1.3c0 1.2-3 1.7-3 3.7h3" />
      </Btn>
      <Btn label="Checklist" on={s.task} onClick={() => c().toggleTaskList().run()}>
        <Ico d="M4 6.5 5.5 8 8 5M4 15.5l1.5 1.5L8 14M11 7h9M11 16h9" />
      </Btn>
      <span className="tb-sep" aria-hidden="true" />
      <Btn label="Align left" on={s.align === "left"} onClick={() => c().setTextAlign("left").run()}>
        <Ico d="M4 6h16M4 12h10M4 18h13" />
      </Btn>
      <Btn label="Align center" on={s.align === "center"} onClick={() => c().setTextAlign("center").run()}>
        <Ico d="M4 6h16M7 12h10M5.5 18h13" />
      </Btn>
      <Btn label="Align right" on={s.align === "right"} onClick={() => c().setTextAlign("right").run()}>
        <Ico d="M4 6h16M10 12h10M7 18h13" />
      </Btn>
      <span className="tb-sep" aria-hidden="true" />
      <Btn label="Clear formatting" onClick={() => c().unsetAllMarks().clearNodes().unsetTextAlign().run()}>
        <Ico d="M6 4h12M12 4l-3 16M4 20l16-16" />
      </Btn>
    </div>
  );
}

/** The formatted editor. `onChange` gets the HTML body after every edit; ⌘S / Ctrl+S calls `onSave`. */
export function RichNote({ initial, editable, onChange, onSave }: { initial: string; editable: boolean; onChange: (html: string) => void; onSave: () => void }) {
  // The editor keeps its first callbacks; these refs point it at the current ones.
  const save = useRef(onSave);
  const change = useRef(onChange);
  useEffect(() => {
    save.current = onSave;
    change.current = onChange;
  });
  const editor = useEditor({
    extensions: EXTENSIONS,
    content: noteBody(initial),
    editable,
    immediatelyRender: false,
    autofocus: editable && !initial ? "end" : false,
    editorProps: {
      attributes: { class: "note-rich", "aria-label": "Note text", spellcheck: "true" },
      handleKeyDown: (_view, e) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
          e.preventDefault();
          save.current();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: e }) => change.current(e.getHTML()),
  });
  if (!editor) return <div className="note-rich-wrap" />;
  return (
    <div className="note-rich-wrap">
      {editable ? <Toolbar editor={editor} /> : null}
      <EditorContent editor={editor} className="note-rich-scroll" />
    </div>
  );
}
