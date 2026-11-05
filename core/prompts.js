// LLM 계열 provider(anthropic-api, claude-cli, …)가 공유하는 프롬프트
import { langName, fallbackOf } from './settings.js';

/**
 * @param {import('./provider.js').TranslateRequest} req
 * @param {object} s 설정
 * @returns {{ system: string, user: string, maxTokens: number }}
 */
export function buildPrompt(req, s) {
  const T = langName(s.targetLang);
  const F = langName(fallbackOf(s));
  const title = req.title ? `\nPage title: ${req.title}` : '';

  if (req.mode === 'word') {
    const system = [
      `You are an instant pop-up dictionary inside a web browser. The user pointed at a word on a page.`,
      `Answer in ${T}. If the word itself is already ${T}, answer in ${F} instead.`,
      `The target word is marked with ⟦ ⟧ in the context. Use the context to pick the right sense.`,
      ``,
      `Output format (plain text, no markdown, no preamble, no quotes):`,
      `Line 1: the meaning that fits THIS context — short and natural (1–8 words), then the part of speech in parentheses. If the word is inflected, add the base form (e.g. "ran → run"). If it is part of a phrasal verb or idiom in the context, translate the whole expression and show it.`,
      s.showAlternatives
        ? `Line 2: only if the word has other common, clearly different meanings — up to 3, separated by " · ". Otherwise omit the line.`
        : `Output only Line 1.`,
      `Be extremely brief.`
    ].join('\n');
    const user = `Word: ${req.text}${req.context ? `\nContext: ${req.context}` : ''}${title}`;
    return { system, user, maxTokens: s.showAlternatives ? 160 : 80 };
  }

  // 문장/구간 번역
  const system = [
    `You are a translation engine embedded in a web browser.`,
    `Translate the text inside <text> into natural, fluent ${T}. If it is already ${T}, translate it into ${F} instead.`,
    `Prefer natural, idiomatic phrasing over word-for-word translation, but stay faithful to the meaning.`,
    `Use <context> (if given) only to resolve ambiguous words and tone — do not translate the context itself.`,
    `Preserve line breaks, numbers, code, URLs and proper nouns.`,
    `Output ONLY the translation. No notes, no quotes, no preamble.`
  ].join('\n');
  const user = (req.context ? `<context>${req.context}</context>${title ? `\n<page_title>${req.title}</page_title>` : ''}\n` : '') +
    `<text>${req.text}</text>`;
  const maxTokens = Math.min(4096, Math.max(256, Math.ceil(req.text.length * 2.5)));
  return { system, user, maxTokens };
}
