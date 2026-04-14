/**
 * UserAvatar — reusable avatar component
 * Shows profile picture if available, otherwise shows initials with a colored background.
 */
import React from "react";
import { cn } from "@/lib/utils";

interface UserAvatarProps {
  name?: string | null;
  avatarUrl?: string | null;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  className?: string;
  /** If true, show a ring border */
  ring?: boolean;
}

const SIZE_MAP = {
  xs: "w-6 h-6 text-[10px]",
  sm: "w-8 h-8 text-xs",
  md: "w-10 h-10 text-sm",
  lg: "w-12 h-12 text-base",
  xl: "w-16 h-16 text-xl",
};

/** Deterministic color from name for pleasant initials backgrounds */
function nameToColor(name: string): string {
  const colors = [
    "bg-blue-500",   "bg-emerald-500", "bg-violet-500",
    "bg-amber-500",  "bg-rose-500",    "bg-cyan-500",
    "bg-indigo-500", "bg-teal-500",    "bg-orange-500",
    "bg-pink-500",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function getInitials(name?: string | null): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export const UserAvatar: React.FC<UserAvatarProps> = ({
  name,
  avatarUrl,
  size = "md",
  className,
  ring = false,
}) => {
  const sizeClass  = SIZE_MAP[size];
  const bgColor    = nameToColor(name || "?");
  const initials   = getInitials(name);
  const ringClass  = ring ? "ring-2 ring-white ring-offset-1" : "";

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name || "User"}
        className={cn(
          "rounded-full object-cover shrink-0",
          sizeClass,
          ringClass,
          className
        )}
        onError={(e) => {
          // fallback to initials on broken image
          (e.target as HTMLImageElement).style.display = "none";
        }}
      />
    );
  }

  return (
    <div
      className={cn(
        "rounded-full flex items-center justify-center shrink-0 font-semibold text-white select-none",
        sizeClass,
        bgColor,
        ringClass,
        className
      )}
      title={name || undefined}
    >
      {initials}
    </div>
  );
};

export default UserAvatar;
