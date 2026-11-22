import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

// The class name helper shadcn/ui and Magic UI components expect.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
