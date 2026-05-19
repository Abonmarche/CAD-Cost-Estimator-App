/**
 * Renders Estimator Assistant output as styled markdown.
 *
 * The agent emits GitHub-flavored markdown — bold, inline code, numbered
 * lists, tables, horizontal rules. We render via react-markdown +
 * remark-gfm and override each element with an Abonmarche-themed component
 * so the result fits the chat panel (small text, navy/sapphire accents,
 * cloud-bordered tables, mono-pill inline code).
 *
 * react-markdown sanitizes the input by default — no script execution, no
 * dangerous HTML — so we can pass LLM output without an extra purifier.
 */

import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Props {
  /** Raw markdown text from the agent. Empty/falsy renders nothing. */
  source: string | null | undefined;
}

export function AssistantMarkdown({ source }: Props) {
  if (!source) return null;
  return (
    <div className="space-y-2 text-sm leading-relaxed text-charcoal">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Headings — shrink to fit a small chat panel. Even an h1 from
          // the agent should read as a section label, not a billboard.
          h1: ({ children }) => (
            <h3 className="text-sm font-semibold uppercase tracking-wide text-navy">
              {children}
            </h3>
          ),
          h2: ({ children }) => (
            <h3 className="text-sm font-semibold uppercase tracking-wide text-navy">
              {children}
            </h3>
          ),
          h3: ({ children }) => (
            <h4 className="text-[13px] font-semibold text-navy">{children}</h4>
          ),
          h4: ({ children }) => (
            <h5 className="text-[13px] font-semibold text-navy">{children}</h5>
          ),

          p: ({ children }) => (
            <p className="leading-relaxed text-charcoal">{children}</p>
          ),

          strong: ({ children }) => (
            <strong className="font-semibold text-navy">{children}</strong>
          ),

          em: ({ children }) => (
            <em className="italic text-charcoal">{children}</em>
          ),

          // Inline code: mono pill, light cloud background.
          code: ({ children }) => (
            <code className="rounded bg-cloud px-1 py-px font-mono text-[12.5px] text-charcoal">
              {children}
            </code>
          ),

          // Fenced code blocks — wrap in a scrolling pre so wide CAD output
          // doesn't blow out the chat panel.
          pre: ({ children }) => (
            <pre className="overflow-x-auto rounded-lg bg-cloud p-3 font-mono text-xs leading-relaxed text-charcoal">
              {children}
            </pre>
          ),

          ul: ({ children }) => (
            <ul className="ml-5 list-disc space-y-1">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="ml-5 list-decimal space-y-1">{children}</ol>
          ),
          li: ({ children }) => (
            <li className="leading-relaxed text-charcoal">{children}</li>
          ),

          // Horizontal rule — the agent uses --- as a section break. Make
          // it subtle so it visually divides without screaming.
          hr: () => <hr className="my-3 border-cloud" />,

          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="text-sapphire underline hover:text-navy"
            >
              {children}
            </a>
          ),

          // Blockquote — rarely used by the agent, but worth styling.
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-sapphire/40 bg-cloud/40 px-3 py-1 text-charcoal">
              {children}
            </blockquote>
          ),

          // Tables — the agent uses these heavily for layer comparison.
          // Allow horizontal scroll on narrow panels.
          table: ({ children }) => (
            <div className="overflow-x-auto rounded-lg border border-cloud bg-white">
              <table className="w-full border-collapse text-xs">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-light text-navy">{children}</thead>
          ),
          tbody: ({ children }) => (
            <tbody className="divide-y divide-cloud">{children}</tbody>
          ),
          tr: ({ children }) => <tr>{children}</tr>,
          th: ({ children }) => (
            <th className="border-b border-cloud px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-3 py-2 align-top text-charcoal">{children}</td>
          ),
        }}
      >
        {source}
      </Markdown>
    </div>
  );
}
