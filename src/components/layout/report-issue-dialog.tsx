import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

const REPO_ISSUES_URL = "https://github.com/AnalogicGoose/Goosic/issues/new";

/**
 * Feedback form that hands off to GitHub: Submit opens a prefilled
 * new-issue page in the default browser with the app version and OS
 * appended, so reports arrive with the diagnostics we always ask for.
 * Voting/discussion happens on GitHub — no backend of our own.
 *
 * Lives beside the other layout dialogs rather than inside its opener: it is
 * reached from the Settings page, and previously sat in the title bar's More
 * menu, which no longer exists.
 */
export function ReportIssueDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  useEffect(() => {
    if (!open) {
      setTitle("");
      setBody("");
    }
  }, [open]);

  const submit = async () => {
    if (!body.trim()) return;
    let version = "unknown";
    try {
      version = await getVersion();
    } catch {
      /* non-Tauri context (plain vite dev) — keep "unknown" */
    }
    const fullBody = [
      body.trim(),
      "",
      "---",
      `App version: ${version}`,
      `OS: ${navigator.userAgent}`,
    ].join("\n");
    const params = new URLSearchParams({ body: fullBody });
    if (title.trim()) params.set("title", title.trim());
    try {
      await openUrl(`${REPO_ISSUES_URL}?${params}`);
      toast.success("Thanks! Finish submitting the issue in your browser.");
      onOpenChange(false);
    } catch (e) {
      toast.error("Couldn't open the browser", { description: String(e) });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Report an issue</DialogTitle>
          <DialogDescription>
            Tell us what went wrong or what you'd like to see. Submitting opens
            a prefilled GitHub issue in your browser — app version and OS are
            attached automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Short summary (optional)"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="What happened? Steps to reproduce, expected vs actual…"
            rows={6}
            className="w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={!body.trim()}>
            Submit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
