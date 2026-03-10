import { toast } from "sonner";

/** Map Supabase/API error codes to user-friendly messages */
export function mapSupabaseError(error: any): string {
  if (!error) return "An unknown error occurred.";

  const code = error.code || error.statusCode || "";
  const msg = error.message || error.details || "";

  // RLS violation
  if (code === "PGRST301" || msg.includes("row-level security")) {
    return "You don't have permission to access this data.";
  }

  // Unique constraint
  if (code === "23505" || msg.includes("duplicate key") || msg.includes("unique constraint")) {
    return "This record already exists. Please check for duplicates.";
  }

  // Not found
  if (code === "PGRST116" || msg.includes("not found")) {
    return "Record not found. It may have been deleted.";
  }

  // Network error
  if (msg.includes("Failed to fetch") || msg.includes("NetworkError") || msg.includes("ERR_NETWORK")) {
    return "Connection issue. Please check your internet connection and try again.";
  }

  // Rate limit
  if (code === 429 || msg.includes("Rate limit") || msg.includes("rate limit")) {
    return "AI service is busy. Please try again in a moment.";
  }

  // Server error
  if (code === 500 || msg.includes("Internal Server Error")) {
    return "Service temporarily unavailable. Please try again.";
  }

  return msg || "An unexpected error occurred.";
}

/** Show a user-friendly toast for any error */
export function showErrorToast(error: any, fallback?: string) {
  const message = mapSupabaseError(error);
  toast.error(fallback || message);
}
