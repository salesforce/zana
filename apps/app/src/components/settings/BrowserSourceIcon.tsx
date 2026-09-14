import type { DesktopBrowserImportSource } from "@zana-ai/zcc-desktop-contract";
import { Globe } from "lucide-react";

function cx(...parts: Array<string | false | undefined | null>): string {
  return parts.filter(Boolean).join(" ");
}

export function BrowserSourceIcon({
  source,
  className,
}: {
  source: Pick<DesktopBrowserImportSource, "name" | "icon">;
  className?: string;
}) {
  if (source.icon) {
    return (
      <img
        src={source.icon}
        alt=""
        aria-hidden
        draggable={false}
        className={cx("browser-source-icon", className)}
      />
    );
  }
  return (
    <span aria-hidden className={cx("browser-source-icon browser-source-icon--fallback", className)}>
      <Globe size={14} />
    </span>
  );
}
