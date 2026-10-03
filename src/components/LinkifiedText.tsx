import { linkifyText } from "./linkified-text";

export function LinkifiedText({ text, className }: { text: string; className?: string }) {
  return (
    <span className={className} style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
      {linkifyText(text).map((part, index) =>
        part.type === "link" ? (
          <a key={index} href={part.href} target="_blank" rel="noopener noreferrer">
            {part.text}
          </a>
        ) : (
          part.text
        ),
      )}
    </span>
  );
}
