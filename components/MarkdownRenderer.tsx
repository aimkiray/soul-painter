'use client';

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { writeClipboardText } from '@/lib/clipboard';

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
    ? '已复制'
    : copyStatus === 'failed'
      ? '失败'
      : '复制';
  const statusClass = copyStatus === 'copied'
    ? 'border-[#00aaaa] text-[#00aaaa]'
    : copyStatus === 'failed'
      ? 'border-[#ff5555] text-[#ff5555]'
      : 'border-[#555] text-[#AAA] hover:border-[#00aaaa] hover:text-[#00aaaa]';

  return (
    <div className="relative my-2 bg-[#0a0a0a] border border-[#666]">
      <button
        type="button"
        onClick={() => { void handleCopy(); }}
        disabled={!codeText}
        className={`absolute right-1 top-1 z-10 border bg-black px-2 py-0.5 text-[0.65rem] leading-4 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 ${statusClass}`}
        aria-label={copyStatus === 'copied' ? '已复制代码' : copyStatus === 'failed' ? '复制代码失败' : '复制代码'}
        title={copyStatus === 'copied' ? '已复制' : copyStatus === 'failed' ? '复制失败' : '复制代码'}
      >
        {buttonText}
      </button>
      <pre className="overflow-x-auto p-2 pt-8">
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
        code({ className, children, ...props }) {
          const isBlock = /language-/.test(className || '') || extractText(children).includes('\n');
          if (!isBlock) {
            return (
              <code className="bg-[#222] text-[#00ffaa] px-1 py-0.5 border border-[#444] text-xs" {...props}>
                {children}
              </code>
            );
          }
          return (
            <code className={`${className || ''} text-xs text-[#CCC]`} {...props}>
              {children}
            </code>
          );
        },
        pre({ children }) {
          return <MarkdownCodeBlock>{children}</MarkdownCodeBlock>;
        },
        a({ href, children }) {
          return (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-[#00aaaa] underline break-all">
              {children}
            </a>
          );
        },
        ul({ children }) {
          return <ul className="list-disc list-inside ml-2 my-1">{children}</ul>;
        },
        ol({ children }) {
          return <ol className="list-decimal list-inside ml-2 my-1">{children}</ol>;
        },
        li({ children }) {
          return <li className="my-0.5">{children}</li>;
        },
        h1({ children }) { return <h1 className="text-[#00ffcc] text-base font-bold mt-2 mb-1">{children}</h1>; },
        h2({ children }) { return <h2 className="text-[#00ffcc] text-sm font-bold mt-2 mb-1">{children}</h2>; },
        h3({ children }) { return <h3 className="text-[#00ffcc] text-sm font-bold mt-1 mb-0.5">{children}</h3>; },
        h4({ children }) { return <h4 className="text-[#00ffcc] text-sm mt-1 mb-0.5">{children}</h4>; },
        p({ children }) { return <p className="my-1">{children}</p>; },
        blockquote({ children }) {
          return <blockquote className="border-l-2 border-[#00aaaa] pl-2 my-1 text-[#999]">{children}</blockquote>;
        },
        hr() { return <hr className="border-[#666] my-2" />; },
        table({ children }) {
          return <table className="border-collapse my-2 text-xs">{children}</table>;
        },
        th({ children }) {
          return <th className="border border-[#666] px-2 py-1 bg-[#222]">{children}</th>;
        },
        td({ children }) {
          return <td className="border border-[#666] px-2 py-1">{children}</td>;
        },
        strong({ children }) { return <strong className="text-white font-bold">{children}</strong>; },
        em({ children }) { return <em className="italic">{children}</em>; },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
