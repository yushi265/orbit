export function OrbitIcon({ name, size = 18 }: { name: "settings" | "calendar"; size?: number }) {
  return (
    <svg
      className="orbit-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {name === "calendar" ? (
        <>
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M16 3v4M8 3v4M3 11h18" />
          <path d="M8 15h2M14 15h2M8 18h2" />
        </>
      ) : (
        <>
          <path d="M10 2h4l.6 3 2.5 1.4 2.9-1 2 3.5-2.3 2v2.8l2.3 2-2 3.5-2.9-1-2.5 1.4-.6 3h-4l-.6-3-2.5-1.4-2.9 1-2-3.5 2.3-2v-2.8l-2.3-2 2-3.5 2.9 1L9.4 5z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );
}
