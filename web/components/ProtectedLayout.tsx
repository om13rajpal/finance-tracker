"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api-client";

const NAV_LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/transactions", label: "Transactions" },
  { href: "/accounts", label: "Accounts" },
  { href: "/investments", label: "Investments" },
  { href: "/budgets", label: "Budgets" },
  { href: "/goals", label: "Goals" },
  { href: "/recurring", label: "Recurring" },
  { href: "/tax", label: "Tax" },
  { href: "/settings", label: "Settings" },
];

export function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { data, error, isError, isLoading } = useQuery({
    queryKey: ["auth-me"],
    queryFn: () => apiFetch<{ email: string }>("/auth/me"),
    retry: false,
  });

  const isUnauthenticated = isError && error instanceof ApiError && error.status === 401;

  useEffect(() => {
    if (isUnauthenticated) router.push("/login");
  }, [isUnauthenticated, router]);

  if (isLoading) return <div className="p-8">Loading...</div>;

  if (isError) {
    if (isUnauthenticated) return null;
    // A non-401 failure (e.g. the API is down) isn't a reason to boot an
    // authenticated user to the login page — surface it instead of redirecting.
    return (
      <div className="p-8 text-sm text-red-600">
        Something went wrong loading this page. Please try again shortly.
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="flex min-h-screen">
      <nav className="w-48 border-r p-4">
        <ul className="flex flex-col gap-2">
          {NAV_LINKS.map((link) => (
            <li key={link.href}>
              <Link href={link.href} className="text-sm hover:underline">
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
