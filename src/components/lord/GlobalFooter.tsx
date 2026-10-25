import { useState, type FormEvent } from "react";
import { ArrowUpRight, MessageSquareText } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

const FEEDBACK_EMAIL = "nagasatwik145@gmail.com";

export function GlobalFooter() {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("Suggestion");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const submitFeedback = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedMessage = message.trim();
    if (trimmedMessage.length < 10) {
      setError("Please add a little more detail (at least 10 characters).");
      return;
    }
    const subject = encodeURIComponent(`LORD AI ${category}`);
    const body = encodeURIComponent(`${trimmedMessage}\n\nPage: ${window.location.href}`);
    window.location.href = `mailto:${FEEDBACK_EMAIL}?subject=${subject}&body=${body}`;
    setError("");
  };

  return (
    <>
      <footer className="w-full border-t border-border/70 bg-background/70 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-5 sm:px-6">
        <div className="mx-auto flex w-full max-w-7xl flex-col items-center justify-between gap-3 text-center sm:flex-row sm:text-left">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex min-h-10 items-center gap-2 rounded-md px-2 text-sm font-medium text-foreground/85 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <MessageSquareText className="h-4 w-4 text-primary" aria-hidden="true" />
            Feedback &amp; Improvements
          </button>
          <div className="flex flex-col items-center gap-1 text-xs text-muted-foreground sm:flex-row sm:gap-4">
            <span>Made by Karnala Naga Satwik</span>
            <a
              className="inline-flex min-h-8 items-center transition-colors hover:text-primary"
              href="/privacy-policy"
            >
              Privacy Policy
            </a>
            <a
              className="inline-flex min-h-8 items-center gap-1 transition-colors hover:text-primary"
              href={`mailto:${FEEDBACK_EMAIL}`}
            >
              {FEEDBACK_EMAIL}
              <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
            </a>
          </div>
        </div>
      </footer>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto border-primary/20 bg-background sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="pr-6">Feedback &amp; Improvements</DialogTitle>
            <DialogDescription>
              Share a suggestion, report an issue, or request an improvement. Your email app will
              open with your message addressed to the LORD AI creator.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitFeedback} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="feedback-category" className="text-sm font-medium">
                Category
              </label>
              <select
                id="feedback-category"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option>Suggestion</option>
                <option>Issue report</option>
                <option>Improvement request</option>
              </select>
            </div>
            <div className="space-y-2">
              <label htmlFor="feedback-message" className="text-sm font-medium">
                Message
              </label>
              <Textarea
                id="feedback-message"
                value={message}
                onChange={(event) => {
                  setMessage(event.target.value);
                  setError("");
                }}
                required
                minLength={10}
                maxLength={4000}
                rows={5}
                placeholder="Tell us what happened or what would make LORD AI better…"
                aria-describedby={error ? "feedback-error" : undefined}
              />
              <div className="flex justify-between gap-3 text-xs text-muted-foreground">
                {error ? (
                  <span id="feedback-error" role="alert" className="text-destructive">
                    {error}
                  </span>
                ) : (
                  <span>At least 10 characters</span>
                )}
                <span>{message.length}/4000</span>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">Continue to email</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
