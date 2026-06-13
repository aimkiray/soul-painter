'use client';

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownRendererProps {
  content: string;
}

export default function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code({ className, children, ...props }) {
          const isBlock = /language-/.test(className || '') || (typeof children === 'string' && children.includes('\n'));
          if (!isBlock) {
            return (
              <code className="bg-[#222] text-[#00ffaa] px-1 py-0.5 border border-[#444] text-xs" {...props}>
                {children}
              </code>
            );
          }
          return (
            <pre className="bg-[#0a0a0a] border border-[#666] p-2 my-2 overflow-x-auto">
              <code className={`${className || ''} text-xs text-[#CCC]`} {...props}>
                {children}
              </code>
            </pre>
          );
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
