import { Children, cloneElement, isValidElement, useLayoutEffect, useRef } from 'react';
import type { ButtonHTMLAttributes, HTMLAttributes } from 'react';

/** Keeps each option's existing click behavior, with one measured selection background. */
export function SegmentedControl({ children, className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  const container = useRef<HTMLDivElement>(null);
  const measureSelection = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    const group = container.current;
    if (!group) return;
    const indicator = group.querySelector<HTMLElement>(':scope > .segmented-indicator');
    if (!indicator) return;
    const buttons = (): HTMLButtonElement[] => [...group.querySelectorAll<HTMLButtonElement>(':scope > button')];
    const measure = (): void => {
      const selected = group.querySelector<HTMLButtonElement>(':scope > button.selected');
      if (!selected || !selected.offsetWidth || !selected.offsetHeight) {
        delete group.dataset.segmentedReady;
        return;
      }
      const groupRect = group.getBoundingClientRect();
      const buttonRect = selected.getBoundingClientRect();
      indicator.style.transform = `translate3d(${buttonRect.left - groupRect.left - group.clientLeft + group.scrollLeft}px, ${buttonRect.top - groupRect.top - group.clientTop + group.scrollTop}px, 0)`;
      indicator.style.width = `${buttonRect.width}px`;
      indicator.style.height = `${buttonRect.height}px`;
      indicator.style.borderRadius = getComputedStyle(selected).borderRadius;
      group.dataset.segmentedReady = 'true';
    };
    measureSelection.current = measure;
    measure();
    // First paint starts under the already selected option, including restored pages.
    const frame = requestAnimationFrame(() => { group.dataset.segmentedMotion = 'true'; });
    const resize = new ResizeObserver(measure);
    resize.observe(group);
    for (const button of buttons()) resize.observe(button);
    const mutations = new MutationObserver(() => {
      // Counts and translated option labels can change width without a selection change.
      resize.disconnect();
      resize.observe(group);
      for (const button of buttons()) resize.observe(button);
      measure();
    });
    mutations.observe(group, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'aria-pressed'] });
    group.addEventListener('scroll', measure, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutations.disconnect();
      group.removeEventListener('scroll', measure);
      measureSelection.current = null;
    };
  }, []);

  useLayoutEffect(() => { measureSelection.current?.(); });

  return <div {...props} role={props.role ?? 'group'} ref={container} className={`segmented segmented-animated ${className}`.trim()}>
    <div className="segmented-indicator" aria-hidden="true" />
    {Children.map(children, (child) => {
      if (!isValidElement<ButtonHTMLAttributes<HTMLButtonElement>>(child) || child.type !== 'button') return child;
      return cloneElement(child, { 'aria-pressed': child.props['aria-pressed'] ?? child.props.className?.split(/\s+/u).includes('selected') ?? false });
    })}
  </div>;
}
