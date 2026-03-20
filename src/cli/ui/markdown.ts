/**
 * Lightweight terminal Markdown renderer using chalk.
 *
 * Handles: headings, bold, italic, inline code, fenced code blocks,
 * unordered/ordered lists, blockquotes, horizontal rules, and links.
 */

import chalk from "chalk";

// ── Inline formatting ───────────────────────────────────────────────────────

function renderInline(text: string): string {
  return (
    text
      // Bold+italic ***text***
      .replace(/\*{3}(.+?)\*{3}/g, (_, t) => chalk.bold.italic(t))
      // Bold **text** or __text__
      .replace(/\*{2}(.+?)\*{2}/g, (_, t) => chalk.bold(t))
      .replace(/_{2}(.+?)_{2}/g, (_, t) => chalk.bold(t))
      // Italic *text* or _text_
      .replace(/\*(.+?)\*/g, (_, t) => chalk.italic(t))
      .replace(/_(.+?)_/g, (_, t) => chalk.italic(t))
      // Inline code `code`
      .replace(/`([^`]+)`/g, (_, t) => chalk.bgGray.white(` ${t} `))
      // Links [text](url) → text (url dimmed)
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) =>
        `${chalk.cyan.underline(label)} ${chalk.dim(`(${url})`)}`)
      // Strikethrough ~~text~~
      .replace(/~~(.+?)~~/g, (_, t) => chalk.strikethrough(t))
  );
}

// ── Block renderer ──────────────────────────────────────────────────────────

export function renderMarkdown(input: string): string {
  const lines = input.split("\n");
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // ── Fenced code block ```lang
    if (/^```/.test(line)) {
      const lang = line.slice(3).trim();
      const header = lang ? chalk.dim(`  ┌─ ${lang}`) : chalk.dim("  ┌─────");
      out.push(header);
      i++;
      while (i < lines.length && !/^```/.test(lines[i]!)) {
        out.push(chalk.dim("  │ ") + chalk.greenBright(lines[i]!));
        i++;
      }
      out.push(chalk.dim("  └─────"));
      i++; // skip closing ```
      continue;
    }

    // ── Headings
    const h3 = /^### (.+)/.exec(line);
    const h2 = /^## (.+)/.exec(line);
    const h1 = /^# (.+)/.exec(line);
    if (h1) { out.push(chalk.bold.cyan(`\n  ${renderInline(h1[1]!)}\n`)); i++; continue; }
    if (h2) { out.push(chalk.bold.cyan(`\n  ${renderInline(h2[1]!)}`)); i++; continue; }
    if (h3) { out.push(chalk.bold(`  ${renderInline(h3[1]!)}`)); i++; continue; }

    // ── Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push(chalk.dim("  ─────────────────────────"));
      i++;
      continue;
    }

    // ── Blockquote
    if (/^>\s?/.test(line)) {
      const content = line.replace(/^>\s?/, "");
      out.push(chalk.dim("  │ ") + chalk.italic(chalk.gray(renderInline(content))));
      i++;
      continue;
    }

    // ── Unordered list
    const ulMatch = /^(\s*)([-*+])\s+(.+)/.exec(line);
    if (ulMatch) {
      const indent = ulMatch[1]!.length;
      const bullet = indent > 0 ? chalk.dim("◦") : chalk.cyan("•");
      out.push(`${"  ".repeat(Math.floor(indent / 2) + 1)}${bullet} ${renderInline(ulMatch[3]!)}`);
      i++;
      continue;
    }

    // ── Ordered list
    const olMatch = /^(\s*)(\d+)\.\s+(.+)/.exec(line);
    if (olMatch) {
      const indent = olMatch[1]!.length;
      const num = chalk.cyan(olMatch[2]! + ".");
      out.push(`${"  ".repeat(Math.floor(indent / 2) + 1)}${num} ${renderInline(olMatch[3]!)}`);
      i++;
      continue;
    }

    // ── Plain line (inline formatting only)
    out.push(line.length === 0 ? "" : renderInline(line));
    i++;
  }

  return out.join("\n");
}
