'use client';

/* eslint-disable @next/next/no-img-element */

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { writeClipboardText } from '@/lib/clipboard';
import { useI18n } from '@/contexts/I18nContext';

interface MarkdownRendererProps {
  content: string;
}

function extractText(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (React.isValidElement(node)) {
    return extractText((node.props as { children?: React.ReactNode }).children);
  }
  return '';
}

function MarkdownCodeBlock({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const [copyStatus, setCopyStatus] = React.useState<'idle' | 'copied' | 'failed'>('idle');
  const feedbackTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const codeText = extractText(children);

  React.useEffect(() => {
    return () => {
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    };
  }, []);

  const handleCopy = async () => {
    if (!codeText) return;
    const ok = await writeClipboardText(codeText);
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    setCopyStatus(ok ? 'copied' : 'failed');
    feedbackTimerRef.current = setTimeout(() => {
      setCopyStatus('idle');
    }, 1600);
  };

  const buttonText = copyStatus === 'copied'
    ? t('copied')
    : copyStatus === 'failed'
      ? t('copyFailed')
      : t('copy');
  const statusClass = copyStatus === 'copied'
    ? 'ring-theme-fg text-theme-fg'
    : copyStatus === 'failed'
      ? 'ring-error/60 text-error'
      : 'ring-theme-fg/30 text-theme-dim hover:ring-theme-fg hover:text-theme-fg';

  return (
    <div className="relative my-8 bg-theme-fg/10 ring-1 ring-theme-fg/30">
      <button
        type="button"
        onClick={() => { void handleCopy(); }}
        disabled={!codeText}
        className={`absolute right-4 top-4 z-10 cursor-pointer bg-theme-bg px-8 py-2 font-mono text-body-10 uppercase ring-1 disabled:cursor-not-allowed disabled:opacity-40 ${statusClass}`}
        aria-label={copyStatus === 'copied' ? t('copiedCode') : copyStatus === 'failed' ? t('copyCodeFailed') : t('copyCode')}
        title={copyStatus === 'copied' ? t('copied') : copyStatus === 'failed' ? t('copyFailed') : t('copyCode')}
      >
        {buttonText}
      </button>
      <pre className="overflow-x-auto p-8 pt-28">
        {children}
      </pre>
    </div>
  );
}

export default function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code({ className, children, node, ...props }) {
          // A fenced block's code node spans multiple source lines even when
          // its body is a single line; inline code never crosses lines.
          const fenced = !!node?.position && node.position.start.line !== node.position.end.line;
          const isBlock = /language-/.test(className || '') || extractText(children).includes('\n') || fenced;
          if (!isBlock) {
            return (
              <code className="bg-theme-fg/10 px-2 py-1 font-mono text-body-10 text-theme-fg ring-1 ring-theme-fg/30" {...props}>
                {children}
              </code>
            );
          }
          return (
            <code className={`${className || ''} font-mono text-body-10 text-theme-fg`} {...props}>
              {children}
            </code>
          );
        },
        pre({ children }) {
          return <MarkdownCodeBlock>{children}</MarkdownCodeBlock>;
        },
        a({ href, children }) {
          return (
            <a href={href} target="_blank" rel="noopener noreferrer" className="break-all text-theme-fg underline underline-offset-2 hover:decoration-dashed">
              {children}
            </a>
          );
        },
        ul({ children }) {
          return <ul className="my-4 ml-8 list-inside list-disc">{children}</ul>;
        },
        ol({ children }) {
          return <ol className="my-4 ml-8 list-inside list-decimal">{children}</ol>;
        },
        li({ children }) {
          return <li className="my-2">{children}</li>;
        },
        h1({ children }) { return <h1 className="mb-4 mt-8 font-semibold text-theme-fg">{children}</h1>; },
        h2({ children }) { return <h2 className="mb-4 mt-8 font-semibold text-theme-fg">{children}</h2>; },
        h3({ children }) { return <h3 className="mb-2 mt-4 font-semibold text-theme-fg">{children}</h3>; },
        h4({ children }) { return <h4 className="mb-2 mt-4 font-semibold text-theme-fg">{children}</h4>; },
        p({ children }) { return <p className="my-4">{children}</p>; },
        blockquote({ children }) {
          return <blockquote className="my-4 border-l-2 border-theme-fg/30 pl-8 text-theme-dim">{children}</blockquote>;
        },
        hr() { return <hr className="my-8 border-theme-fg/30" />; },
        table({ children }) {
          return <table className="my-8 border-collapse font-mono text-body-10">{children}</table>;
        },
        th({ children }) {
          return <th className="bg-theme-fg/10 px-8 py-4 ring-1 ring-theme-fg/30">{children}</th>;
        },
        td({ children }) {
          return <td className="px-8 py-4 ring-1 ring-theme-fg/30">{children}</td>;
        },
        img({ src, alt }) {
          return <img src={typeof src === 'string' ? src : undefined} alt={alt || ''} className="max-w-full" />;
        },
        strong({ children }) { return <strong className="font-semibold text-theme-fg">{children}</strong>; },
        em({ children }) { return <em className="italic">{children}</em>; },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
