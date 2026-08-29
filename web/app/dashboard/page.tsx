"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import { ProtectedLayout } from "@/components/ProtectedLayout";
import { Card } from "@/components/ui/Card";

interface DashboardData {
  netWorth: number;
  guiltFreeMoney: { planned: number; spent: number; remaining: number };
  budgetVsSpend: { categoryId: string; name: string; budgetLimit: number; spent: number }[];
}

interface RecurringItem {
  _id: string;
  name: string;
  amount: number;
  nextDueDate: string;
  type: "expense" | "income";
}

function formatInr(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

export default function DashboardPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => apiFetch<DashboardData>("/dashboard"),
  });

  const { data: upcoming, isLoading: isUpcomingLoading } = useQuery({
    queryKey: ["recurring-upcoming"],
    queryFn: () => apiFetch<RecurringItem[]>("/recurring/upcoming?days=30"),
  });

  return (
    <ProtectedLayout>
      <h1 className="mb-6 text-2xl font-semibold">Dashboard</h1>
      {isLoading ? (
        <p className="text-sm text-gray-500">Loading...</p>
      ) : isError || !data ? (
        <p className="text-sm text-red-600">
          Could not load dashboard data. Please try again shortly.
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          <Card>
            <p className="text-sm text-gray-500">Net Worth</p>
            <p className="text-3xl font-bold">{formatInr(data.netWorth)}</p>
          </Card>

          <Card>
            <p className="text-sm text-gray-500">Guilt-Free Money This Month</p>
            <p className="text-2xl font-bold">
              {formatInr(data.guiltFreeMoney.remaining)} remaining
            </p>
            <p className="text-sm text-gray-500">
              Planned {formatInr(data.guiltFreeMoney.planned)} · Spent{" "}
              {formatInr(data.guiltFreeMoney.spent)}
            </p>
          </Card>

          <Card>
            <p className="mb-3 text-sm text-gray-500">Budget vs. Spend This Month</p>
            {data.budgetVsSpend.length === 0 ? (
              <p className="text-sm text-gray-500">No expense categories with budgets yet.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {data.budgetVsSpend.map((row) => (
                  <div key={row.categoryId}>
                    <div className="flex justify-between text-sm">
                      <span>{row.name}</span>
                      <span>
                        {formatInr(row.spent)} / {formatInr(row.budgetLimit)}
                      </span>
                    </div>
                    <div className="h-2 w-full rounded bg-gray-200">
                      <div
                        className="h-2 rounded bg-black"
                        style={{
                          width: `${
                            row.budgetLimit > 0
                              ? Math.min(100, (row.spent / row.budgetLimit) * 100)
                              : 0
                          }%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <p className="mb-3 text-sm text-gray-500">Upcoming (Next 30 Days)</p>
            {isUpcomingLoading ? (
              <p className="text-sm text-gray-500">Loading...</p>
            ) : !upcoming || upcoming.length === 0 ? (
              <p className="text-sm text-gray-500">Nothing upcoming in the next 30 days.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {upcoming.map((item) => (
                  <li key={item._id} className="flex justify-between text-sm">
                    <span>{item.name}</span>
                    <span>
                      {formatInr(item.amount)} on {new Date(item.nextDueDate).toLocaleDateString()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </ProtectedLayout>
  );
}
