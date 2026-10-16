import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center p-6 text-center">
      <p className="text-6xl font-light tracking-tight text-fg">404</p>
      <p className="mt-2 text-sm text-muted">This page doesn&apos;t exist.</p>
      <Link href="/" className="mt-5 inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-medium text-primary-fg">
        Back to dashboard
      </Link>
    </div>
  );
}
