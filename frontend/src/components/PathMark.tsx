/**
 * The product's own mark: three waypoints climbing toward a filled goal,
 * joined by the route between them — a learning path, not a generic
 * education glyph (book/cap/lightbulb). Renders in `currentColor` so it
 * drops into the same "blue box, white icon" slot used throughout the UI.
 * Mirrors public/favicon.svg exactly, so the browser tab and the in-app
 * logo are the same mark.
 */
export function PathMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M16 46 L30 34 L44 20"
        stroke="currentColor"
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.55"
      />
      <circle cx="16" cy="46" r="5" fill="currentColor" opacity="0.75" />
      <circle cx="30" cy="34" r="5" fill="currentColor" opacity="0.75" />
      <circle cx="45" cy="19" r="8" fill="currentColor" />
    </svg>
  );
}
