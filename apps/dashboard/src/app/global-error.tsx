"use client";

export default function GlobalError({
  reset,
}: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-slate-900 antialiased">
        <div className="mx-auto flex max-w-xl flex-col items-center gap-4 px-6 py-24 text-center">
          <h1 className="text-2xl font-semibold">Something went wrong</h1>
          <p className="text-sm text-slate-600">
            The app failed to render. Try reloading; if it keeps happening, contact support.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={reset}
              className="rounded-md border border-slate-900 bg-slate-900 px-4 py-2 text-sm font-medium text-white"
            >
              Reload
            </button>
            <a
              href="/app/projects"
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-900"
            >
              Back to projects
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
