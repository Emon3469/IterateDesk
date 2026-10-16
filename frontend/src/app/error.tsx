"use client";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center p-6 text-center">
      <p className="text-lg font-medium text-fg">Something went wrong</p>
      <p className="mt-1 text-sm text-muted">The page failed to render. Please try again.</p>
      <button
        type="button"
        onClick={reset}
        className="mt-5 inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-medium text-primary-fg"
      >
        Try again
      </button>
    </div>
  );
}
