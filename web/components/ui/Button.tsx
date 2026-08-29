import { ButtonHTMLAttributes } from "react";
import clsx from "clsx";

export function Button({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={clsx("rounded bg-black px-3 py-2 text-white disabled:opacity-50", className)}
      {...props}
    />
  );
}
