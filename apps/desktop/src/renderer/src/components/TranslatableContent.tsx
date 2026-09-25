import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { TranslationRequest, TranslationTargetLanguage } from '@easyhub/types';
import { ParagraphTranslatedContent } from './ParagraphTranslatedContent';

export interface TranslationPreferences {
  automatic: boolean;
  target: TranslationTargetLanguage;
  repository?: TranslationRequest['repository'];
  names?: string[];
}
export const TranslationPreferencesContext = createContext<TranslationPreferences>({ automatic: false, target: 'zh-CN' });

let requestNumber = 0;
interface TranslatableContentProps {
  text: string;
  format: 'text' | 'markdown';
  render: (value: string) => ReactNode;
  className?: string;
  protectedNames?: string[];
  paragraphMode?: boolean;
}

export function TranslatableContent(props: TranslatableContentProps) {
  const preferences = useContext(TranslationPreferencesContext);
  if (props.paragraphMode && props.format === 'markdown') return <ParagraphTranslatedContent
    text={props.text} render={props.render} className={props.className ?? ''} automatic={preferences.automatic}
    target={preferences.target} repository={preferences.repository} names={[...(preferences.names ?? []), ...(props.protectedNames ?? [])]} />;
  return <WholeTranslatableContent {...props} />;
}

function WholeTranslatableContent({ text, format, render, className = '', protectedNames = [] }: TranslatableContentProps) {
  const { automatic, target, repository, names = [] } = useContext(TranslationPreferencesContext);
  const glossary = JSON.stringify({ repository, names, protectedNames });
  const element = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [translation, setTranslation] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!element.current) return;
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const observer = new IntersectionObserver(([entry]) => setVisible(entry?.isIntersecting ?? false), { rootMargin: '300px 0px' });
    observer.observe(element.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { setTranslation(null); setFailed(false); }, [text, format, target, glossary]);
  useEffect(() => { if (!automatic) setFailed(false); }, [automatic]);
  useEffect(() => {
    if (!automatic || !visible || translation !== null || failed || !text.trim()) return;
    const api = window.easyHub;
    if (!api) { setFailed(true); return; }
    let active = true;
    const id = `translation-${Date.now()}-${++requestNumber}`;
    void api.translateContent({ id, text, format, target, repository, protectedNames: [...names, ...protectedNames] })
      .then((value) => { if (active) setTranslation(value); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; void api.cancelTranslation(id); };
  }, [automatic, visible, translation, failed, text, format, target, glossary]);

  return <div ref={element} className={`translatable-content ${className}`} data-content-original="true">
    {render(automatic && translation !== null ? translation : text)}
  </div>;
}
