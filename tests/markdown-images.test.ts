// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { test } from "node:test";
import assert from "node:assert/strict";
import { markdownImageLocation, markdownImageUrl, insertMarkdownImage, resizedMarkdownImage } from "../lib/markdown-images";
import { parseInlineMarkdown, richInlineHtml } from "../lib/markdown-rich-editor";

test("relative image paths resolve inside the document folder without remote requests", () => {
  assert.deepEqual(markdownImageLocation("attachments/Bild%20%C3%A4.png", "Anlagen"), { filename: "Bild ä.png", subfolder: "Anlagen/attachments", relativePath: "attachments/Bild ä.png" });
  assert.match(markdownImageUrl("attachments/b.png", 2, 3, "Anlagen")!, /folder=Anlagen%2Fattachments/);
  for (const path of ["../privat.png", "attachments/../../privat.png", "/x.png", "https://example.invalid/x.png", "//example.invalid/x.png", "data:image/png;base64,eA==", "attachments/%2e%2e/x.png", "attachments/%2Fprivate.png", "attachments\\x.png", "x.svg", "a//x.png", "x.png?secret", "__PATH_SEPARATOR_POSIX__/x.png"]) assert.equal(markdownImageLocation(path), null, path);
});
test("image insertion and sizing preserve standard Markdown and surrounding text", () => {
  const edit = insertMarkdownImage("VorNach", { start: 3, end: 3 }, "attachments/b.png", "Bild [1]");
  assert.equal(edit.markdown, "Vor\n\n![Bild \\[1\\]](attachments/b.png)\n\nNach");
  const image = "![Bild \\[1\\]](attachments/b.png)";
  assert.equal(resizedMarkdownImage(image, 300), image + "{width=300}");
  assert.equal(resizedMarkdownImage(image + "{width=300}", 200), image + "{width=200}");
  assert.equal(resizedMarkdownImage(image, 1), image + "{width=48}");
  const token = parseInlineMarkdown(image + "{width=300}")[0];
  assert.equal(token.type, "image"); assert.equal(token.width, 300); assert.equal(token.raw, image + "{width=300}");
  const resolve = (ref: string) => markdownImageUrl(ref, 2, 3);
  assert.match(richInlineHtml(image + "{width=300}", false, false, resolve), /width="300"/);
  assert.ok(!richInlineHtml("![Tracker](https://example.invalid/x.png)", false, false, resolve).includes("<img"));
  assert.ok(!richInlineHtml(image, true, false, resolve).includes("<img"));
});
