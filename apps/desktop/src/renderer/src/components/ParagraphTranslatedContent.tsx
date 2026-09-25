import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { TranslationRequest, TranslationTargetLanguage } from '@easyhub/types';
import { splitMarkdownParagraphs, type MarkdownParagraph } from './markdownParagraphs';

let paragraphRequestNumber = 0;

function Paragraph({ paragraph, definitions, render, automatic, target, repository, names }: {
  paragraph: MarkdownParagraph;
  definitions: string;
  render: (value: string) => ReactNode;
  automatic: boolean;
  target: TranslationTargetLanguage;
  repository?: TranslationRequest['repository'];
  names: string[];
}) {
  const element = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [translated, setTranslated] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const glossary = JSON.stringify({ repository, names });

  useEffect(() => {
    if (!paragraph.hasProse || !element.current) return;
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const observer = new IntersectionObserver(([entry]) => setVisible(entry?.isIntersecting ?? false), { rootMargin: '300px 0px' });
    observer.observe(element.current);
    return () => observer.disconnect();
  }, [paragraph.key, paragraph.hasProse]);

  useEffect(() => { setTranslated(null); setFailed(false); }, [paragraph.source, target, glossary]);
  useEffect(() => { if (!automatic) setFailed(false); }, [automatic]);
  useEffect(() => {
    if (!paragraph.hasProse || !automatic || !visible || translated !== null || failed) return;
    const api = window.easyHub;
    if (!api) { setFailed(true); return; }
    let active = true;
    const id = `paragraph-${Date.now()}-${++paragraphRequestNumber}`;
    void api.translateContent({ id, text: paragraph.source, format: 'markdown', target, repository, protectedNames: names })
      .then((value) => { if (active) setTranslated(value); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; void api.cancelTranslation(id); };
  }, [paragraph.hasProse, paragraph.source, automatic, visible, translated, failed, target, glossary]);

  const display = automatic && translated !== null ? translated : paragraph.source;
  const markdown = definitions ? `${display}\n\n${definitions}` : display;
  return <div ref={element} className="translation-paragraph" data-translation-paragraph={paragraph.key}>
    <div data-content-original="true">{render(markdown)}</div>
  </div>;
}

export function ParagraphTranslatedContent({ text, render, className, automatic, target, repository, names }: {
  text: string;
  render: (value: string) => ReactNode;
  className: string;
  automatic: boolean;
  target: TranslationTargetLanguage;
  repository?: TranslationRequest['repository'];
  names: string[];
}) {
  const { paragraphs, definitions, linkedNames } = useMemo(() => splitMarkdownParagraphs(text), [text]);
  const protectedNames = useMemo(() => [...new Set([...names, ...linkedNames])].slice(0, 100), [names, linkedNames]);
  return <div className={`translatable-content paragraph-translatable-content ${className}`}>
    <div className="translation-paragraphs">{paragraphs.map((paragraph) => <Paragraph key={paragraph.key} paragraph={paragraph}
      definitions={definitions} render={render} automatic={automatic} target={target}
      repository={repository} names={protectedNames} />)}</div>
  </div>;
}
