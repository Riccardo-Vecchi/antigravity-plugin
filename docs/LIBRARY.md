# 📚 Library

Open **Library**, below **Automations**. Search filenames and artifact descriptions, filter by file type, or star files to find them under **Favorites**. **Add files** adds supported local files without copying them. **Remove from Library** untracks a manually added file; it never deletes the original.

## 🔎 What appears

Library discovers saved files in Antigravity's local conversation artifact folders, plus supported outputs referenced by file-writing tools or file links in assistant transcripts. It does not scan your home folder, browser profiles or whole project trees. Internal logs, uploaded inputs, scratch folders and symbolic links are excluded. Remote-only and unsaved plugin views are not local files and are not indexed.

Use **Refresh Library** for new or changed outputs. Very large transcripts and catalogs are bounded; Library reports incomplete discovery and offers **Add files** for missing outputs. An old transcript format, an output created only by a shell command without a file link, or a moved file may require adding the file manually.

## 👁️ Previews

| Format | Built-in preview |
| --- | --- |
| DOCX | Read-only page rendering, including ordinary formatting, images and tables; complex Word features can differ |
| XLSX | Sheet tabs and saved cell values; up to 1,000 rows and 100 columns per sheet; no recalculation or chart rendering |
| PPTX | Slide text and embedded images; not a pixel-exact layout or animation player |
| Markdown, text, TeX | Formatted Markdown or source text; TeX is not compiled |
| Images, audio and video | Local preview using Chromium-supported codecs |
| PDF | Offline PDF.js rendering with page navigation and selectable text; complex font/decoder features can differ |
| GLB, self-contained glTF, STL, OBJ, PLY | Interactive orbit, zoom and pan; external textures, sidecar buffers and compressed decoder extensions are not loaded |
| HTML | Isolated interactive preview; external resources start blocked; **Allow online resources** enables HTTPS resources for that preview only |
| ODT, ODS, ODP, RTF | Listed and revealed in the file manager; open the original in its desktop application |

Files above 25 MiB remain listed but are not loaded into the built-in viewer. **Show in folder** reveals the original. Generated files also offer **Open conversation** when their originating conversation is known.

Select text in a supported document preview, then choose **Discuss selection**. The plugin appends the file path and selected text to the native chat draft. It preserves existing draft text and does not send the message. Interactive HTML does not expose its selections to this action.

## 🔒 Local processing

Preview engines ship with the plugin. Documents are not uploaded to an online converter. Viewers run in sandboxed iframes with opaque origins, without Node, native application APIs or agent tools. File contents are loaded only for a requested preview or a small image thumbnail. HTML can run scripts inside its isolated preview; allowing online resources can make network requests from that preview.

Only favorites and manually added paths persist in the plugin's private `library.json`. The discovery catalog and extracted transcript references remain in memory. `workspace.json` stores the independent sidebar-mode choice. Official conversation files and document originals remain read-only.

The shared implementation runs on Linux and Windows. Interactive validation was performed on Linux; Windows runtime validation remains pending.
