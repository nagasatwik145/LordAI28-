import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  Bookmark,
  Check,
  CircleAlert,
  Compass,
  Plus,
  Search,
  Share2,
  Sparkles,
  ThumbsUp,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/lord/AppShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authenticatedFetch } from "@/lib/authenticated-fetch";

type Creation = {
  id: string;
  slug: string;
  creator_slug: string;
  creator_name: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  public_spec: { title?: string; gameType?: string; schemaVersion?: number };
  status: string;
  moderation_status: string;
  helpful_count: number;
  published_at: string | null;
};
type Game = {
  id: string;
  spec: { title: string; description: string; gameType?: string; schemaVersion?: number };
  updated_at: string;
};
const categories = ["All", "games", "agents", "templates", "learning"];
const api = async (body?: unknown, query = "") => {
  const response = body
    ? await authenticatedFetch("/api/community", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
    : await authenticatedFetch(`/api/community${query}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Community request failed.");
  return data;
};

export const Route = createFileRoute("/_authenticated/community")({
  component: CommunityPage,
  head: () => ({
    meta: [
      { title: "LORD Community" },
      { name: "description", content: "Discover and share LORD creations." },
    ],
  }),
});

function CommunityPage() {
  const qc = useQueryClient();
  const [category, setCategory] = useState("All");
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"discover" | "creator">("discover");
  const [editing, setEditing] = useState<Creation | null>(null);
  const [sourceId, setSourceId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [reportId, setReportId] = useState("");
  const [reportDetails, setReportDetails] = useState("");
  const [reportReason, setReportReason] = useState("spam");
  const [reportTarget, setReportTarget] = useState("content");
  const [sort, setSort] = useState("recent");
  const creationsQuery = useQuery({
    queryKey: ["community", tab, category, search],
    queryFn: () =>
      api(
        undefined,
        tab === "creator"
          ? "?own=1"
          : `?q=${encodeURIComponent(search)}${category === "All" ? "" : `&category=${category}`}`,
      ),
  });
  const gamesQuery = useQuery({
    queryKey: ["community-games"],
    enabled: tab === "creator",
    queryFn: async () => {
      const result = await authenticatedFetch("/api/games", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list" }),
      });
      if (!result.ok) throw new Error("Could not load saved games.");
      return (await result.json()).games as Game[];
    },
  });
  const moderationQuery = useQuery({
    queryKey: ["community-moderation"],
    enabled: tab === "creator",
    queryFn: () => api(undefined, "?moderation=1"),
  });
  const mutation = useMutation({
    mutationFn: (body: unknown) => api(body),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["community"] });
      setEditing(null);
      setSourceId("");
      setTitle("");
      setDescription("");
      setTags("");
      toast.success("Community item saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const report = useMutation({
    mutationFn: (body: unknown) => api(body),
    onSuccess: async () => {
      setReportId("");
      setReportDetails("");
      toast.success("Report submitted for review");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const creations = useMemo<Creation[]>(
    () => creationsQuery.data?.creations ?? [],
    [creationsQuery.data?.creations],
  );
  const voted = new Set<string>(creationsQuery.data?.voted ?? []);
  const bookmarked = new Set<string>(creationsQuery.data?.bookmarked ?? []);
  const visible = useMemo(
    () =>
      creations
        .filter((c) =>
          `${c.title} ${c.description} ${c.tags.join(" ")}`
            .toLowerCase()
            .includes(search.toLowerCase()),
        )
        .sort((a, b) =>
          sort === "helpful"
            ? b.helpful_count - a.helpful_count
            : (b.published_at ?? "").localeCompare(a.published_at ?? ""),
        ),
    [creations, search, sort],
  );

  const startSubmit = () => {
    setEditing(null);
    setSourceId("");
    setTitle("");
    setDescription("");
    setTags("");
  };
  const submit = (status: "draft" | "published") => {
    if (!sourceId || !title.trim() || description.trim().length < 10) {
      toast.error("Choose a game and complete the title and description.");
      return;
    }
    mutation.mutate({
      action: "create",
      sourceId,
      title,
      description,
      category: "games",
      tags: tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      status,
    });
  };
  const edit = (item: Creation) => {
    setEditing(item);
    setTitle(item.title);
    setDescription(item.description);
    setTags(item.tags.join(", "));
  };

  return (
    <AppShell>
      <main className="mx-auto max-w-7xl py-8">
        <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[.22em] text-cyan-300">
              <Sparkles size={15} /> LORD COMMUNITY
            </p>
            <h1 className="text-4xl font-bold text-white">Create. Share. Discover.</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Explore community creations and share your own WorldForge games. Your workspace stays
              private.
            </p>
          </div>
          <Button
            onClick={() => {
              setTab("creator");
              startSubmit();
            }}
          >
            <Plus className="mr-2 h-4 w-4" /> Share a creation
          </Button>
        </header>
        <div className="mb-6 flex flex-wrap gap-2">
          <Button
            variant={tab === "discover" ? "default" : "outline"}
            onClick={() => setTab("discover")}
          >
            <Compass className="mr-2 h-4 w-4" /> Discover
          </Button>
          <Button
            variant={tab === "creator" ? "default" : "outline"}
            onClick={() => setTab("creator")}
          >
            <Bookmark className="mr-2 h-4 w-4" /> Creator dashboard
          </Button>
        </div>
        {tab === "discover" && (
          <>
            <div className="mb-6 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-9"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search creations, descriptions, and tags"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {categories.map((c) => (
                  <Button
                    key={c}
                    size="sm"
                    variant={category === c ? "default" : "outline"}
                    onClick={() => setCategory(c)}
                  >
                    {c === "All" ? "All" : c[0].toUpperCase() + c.slice(1)}
                  </Button>
                ))}
              </div>
            </div>
            <div className="mb-4 flex justify-end">
              <select
                aria-label="Sort community creations"
                className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={sort}
                onChange={(e) => setSort(e.target.value)}
              >
                <option value="recent">Recently published</option>
                <option value="helpful">Most helpful</option>
              </select>
            </div>
            {creationsQuery.isLoading ? (
              <p className="py-16 text-center text-muted-foreground">
                Loading community creations…
              </p>
            ) : creationsQuery.isError ? (
              <Card className="p-8 text-center text-rose-200">
                <CircleAlert className="mx-auto mb-3" />
                Community is unavailable right now. Try again shortly.
              </Card>
            ) : visible.length === 0 ? (
              <Card className="p-12 text-center">
                <Compass className="mx-auto mb-3 h-8 w-8 text-cyan-300" />
                <h2 className="text-lg font-semibold">Nothing published here yet</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Try another search or be the first to share a creation.
                </p>
              </Card>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {visible.map((item) => (
                  <Card key={item.id} className="flex flex-col border-white/10 bg-card/70 p-5">
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <span className="rounded-full bg-cyan-400/10 px-2.5 py-1 text-xs capitalize text-cyan-200">
                        {item.category}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        v{item.public_spec?.schemaVersion === 3 ? "3D" : "1.0"}
                      </span>
                    </div>
                    <h2 className="text-xl font-semibold">{item.title}</h2>
                    <p className="mt-2 line-clamp-3 flex-1 text-sm text-muted-foreground">
                      {item.description}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-1.5">
                      {item.tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded bg-white/5 px-2 py-1 text-[11px] text-muted-foreground"
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                    <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-3">
                      <Link
                        className="text-xs text-muted-foreground hover:text-cyan-200"
                        to="/community/creators/$name"
                        params={{ name: item.creator_slug }}
                      >
                        by {item.creator_name}
                      </Link>
                      <span className="flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={voted.has(item.id)}
                          onClick={() => mutation.mutate({ action: "vote", id: item.id })}
                        >
                          <ThumbsUp className="mr-1 h-4 w-4" />
                          {item.helpful_count}
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="Save creation"
                          title="Save creation"
                          onClick={() => mutation.mutate({ action: "bookmark", id: item.id })}
                        >
                          <Bookmark
                            className={bookmarked.has(item.id) ? "h-4 w-4 fill-current" : "h-4 w-4"}
                          />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          title="Share link"
                          onClick={() => {
                            void navigator.clipboard
                              .writeText(`${location.origin}/community/${item.slug}`)
                              .then(
                                () => toast.success("Link copied"),
                                () => toast.error("Could not copy link"),
                              );
                          }}
                        >
                          <Share2 className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          title="Report creation"
                          onClick={() => {
                            setReportId(item.id);
                            setReportTarget("content");
                          }}
                        >
                          <CircleAlert className="h-4 w-4" />
                        </Button>
                      </span>
                    </div>
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      {item.public_spec?.gameType ?? "WorldForge game"} · original game remains
                      private
                    </p>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}
        {tab === "creator" && (
          <div className="grid gap-6 lg:grid-cols-[minmax(280px,.8fr)_minmax(0,1.2fr)]">
            <Card className="space-y-4 p-5">
              <div>
                <h2 className="text-lg font-semibold">Share a WorldForge game</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Only the selected game's public specification is copied into the listing. Files
                  and workspace data stay private.
                </p>
              </div>
              {gamesQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading saved games…</p>
              ) : gamesQuery.isError ? (
                <p role="alert" className="text-sm text-rose-200">
                  {(gamesQuery.error as Error).message}
                </p>
              ) : (
                <>
                  <Label htmlFor="community-game">Saved game</Label>
                  <select
                    id="community-game"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={sourceId}
                    onChange={(e) => {
                      const game = gamesQuery.data?.find((g) => g.id === e.target.value);
                      setSourceId(e.target.value);
                      if (game && !title) {
                        setTitle(game.spec.title);
                        setDescription(game.spec.description);
                      }
                    }}
                  >
                    <option value="">Choose one of your saved games</option>
                    {gamesQuery.data?.map((game) => (
                      <option value={game.id} key={game.id}>
                        {game.spec.title}
                      </option>
                    ))}
                  </select>
                  <Label htmlFor="community-title">Public title</Label>
                  <Input
                    id="community-title"
                    maxLength={100}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                  <Label htmlFor="community-description">Description</Label>
                  <textarea
                    id="community-description"
                    maxLength={2000}
                    className="min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Describe what people will find…"
                  />
                  <Label htmlFor="community-tags">Tags (comma separated)</Label>
                  <Input
                    id="community-tags"
                    value={tags}
                    onChange={(e) => setTags(e.target.value)}
                    placeholder="arcade, pixel-art"
                  />
                  <div className="rounded-md border border-cyan-300/20 bg-cyan-300/5 p-3 text-xs text-cyan-100">
                    New public listings enter moderation review. Approved listings become
                    discoverable.
                  </div>
                  <div className="flex gap-2">
                    <Button
                      disabled={mutation.isPending}
                      variant="outline"
                      onClick={() => submit("draft")}
                    >
                      Save draft
                    </Button>
                    <Button disabled={mutation.isPending} onClick={() => submit("published")}>
                      {mutation.isPending ? "Saving…" : "Submit for review"}
                    </Button>
                  </div>
                </>
              )}
            </Card>
            <section>
              {moderationQuery.data?.moderator && (
                <div className="mb-6 space-y-3">
                  <h2 className="text-lg font-semibold">Moderator review queue</h2>
                  {moderationQuery.data.creations?.map(
                    (item: { id: string; title: string; creator_name: string }) => (
                      <Card
                        key={item.id}
                        className="flex flex-wrap items-center justify-between gap-3 border-amber-300/20 p-4"
                      >
                        <div>
                          <h3 className="font-semibold">{item.title}</h3>
                          <p className="text-xs text-muted-foreground">
                            by {item.creator_name} · awaiting review
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={() => {
                              mutation.mutate({
                                action: "moderate",
                                id: item.id,
                                moderationStatus: "approved",
                              });
                              void moderationQuery.refetch();
                            }}
                          >
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              mutation.mutate({
                                action: "moderate",
                                id: item.id,
                                moderationStatus: "rejected",
                              });
                              void moderationQuery.refetch();
                            }}
                          >
                            Reject
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              mutation.mutate({
                                action: "moderate",
                                id: item.id,
                                moderationStatus: "removed",
                              });
                              void moderationQuery.refetch();
                            }}
                          >
                            Remove
                          </Button>
                        </div>
                      </Card>
                    ),
                  )}
                  {moderationQuery.data.reports?.map(
                    (report: {
                      id: string;
                      reason: string;
                      details: string;
                      creation_id: string | null;
                    }) => (
                      <Card
                        key={report.id}
                        className="flex flex-wrap items-center justify-between gap-3 border-rose-300/20 p-4"
                      >
                        <div>
                          <h3 className="font-semibold">Report · {report.reason}</h3>
                          <p className="max-w-xl text-xs text-muted-foreground">
                            {report.details ||
                              (report.creation_id ? "Reported creation" : "Reported creator")}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              mutation.mutate({
                                action: "moderate",
                                reportId: report.id,
                                reportStatus: "resolved",
                              });
                              void moderationQuery.refetch();
                            }}
                          >
                            Resolve
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              mutation.mutate({
                                action: "moderate",
                                reportId: report.id,
                                reportStatus: "dismissed",
                              });
                              void moderationQuery.refetch();
                            }}
                          >
                            Dismiss
                          </Button>
                        </div>
                      </Card>
                    ),
                  )}
                </div>
              )}
              <h2 className="mb-3 text-lg font-semibold">Your creations</h2>
              {creationsQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading drafts…</p>
              ) : creations.length === 0 ? (
                <Card className="p-8 text-center text-sm text-muted-foreground">
                  You have no drafts or listings yet.
                </Card>
              ) : (
                <div className="space-y-3">
                  {creations.map((item) => (
                    <Card
                      key={item.id}
                      className="flex flex-wrap items-center justify-between gap-3 p-4"
                    >
                      <div>
                        <h3 className="font-semibold">{item.title}</h3>
                        <p className="text-xs capitalize text-muted-foreground">
                          {item.status} · moderation {item.moderation_status}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => edit(item)}>
                          Edit
                        </Button>
                        {item.status === "published" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => mutation.mutate({ action: "unpublish", id: item.id })}
                          >
                            Unpublish
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            onClick={() =>
                              mutation.mutate({
                                action: "update",
                                id: item.id,
                                status: "published",
                              })
                            }
                          >
                            Publish
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => mutation.mutate({ action: "delete", id: item.id })}
                        >
                          Delete
                        </Button>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
              {editing && (
                <Card className="mt-4 space-y-3 p-4">
                  <h3 className="font-semibold">Edit listing</h3>
                  <Input value={title} onChange={(e) => setTitle(e.target.value)} />
                  <textarea
                    className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                  <Input
                    value={tags}
                    onChange={(e) => setTags(e.target.value)}
                    placeholder="Tags"
                  />
                  <div className="flex gap-2">
                    <Button
                      onClick={() =>
                        mutation.mutate({
                          action: "update",
                          id: editing.id,
                          title,
                          description,
                          tags: tags
                            .split(",")
                            .map((t) => t.trim())
                            .filter(Boolean),
                        })
                      }
                    >
                      Save changes
                    </Button>
                    <Button variant="outline" onClick={() => setEditing(null)}>
                      Cancel
                    </Button>
                  </div>
                </Card>
              )}
            </section>
          </div>
        )}
        {reportId && (
          <div
            role="dialog"
            aria-modal="true"
            className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4"
          >
            <Card className="w-full max-w-md space-y-4 p-5">
              <h2 className="font-semibold">Report content or creator</h2>
              <Label htmlFor="report-target">Report</Label>
              <select
                id="report-target"
                className="w-full rounded-md border border-input bg-background px-3 py-2"
                value={reportTarget}
                onChange={(e) => setReportTarget(e.target.value)}
              >
                <option value="content">This creation</option>
                <option value="creator">This creator</option>
              </select>
              <Label htmlFor="report-reason">Reason</Label>
              <select
                id="report-reason"
                className="w-full rounded-md border border-input bg-background px-3 py-2"
                value={reportReason}
                onChange={(e) => setReportReason(e.target.value)}
              >
                <option value="spam">Spam</option>
                <option value="harmful">Harmful content</option>
                <option value="copyright">Copyright</option>
                <option value="privacy">Privacy concern</option>
                <option value="other">Other</option>
              </select>
              <textarea
                className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                maxLength={1000}
                value={reportDetails}
                onChange={(e) => setReportDetails(e.target.value)}
                placeholder="Optional details"
              />
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setReportId("")}>
                  Cancel
                </Button>
                <Button
                  disabled={report.isPending}
                  onClick={() =>
                    report.mutate({
                      action: "report",
                      id: reportId,
                      ...(reportTarget === "creator" ? { reportedUserId: "creator" } : {}),
                      reason: reportReason,
                      details: reportDetails,
                    })
                  }
                >
                  Submit report
                </Button>
              </div>
            </Card>
          </div>
        )}
        {editing === null && tab === "creator" && (
          <span className="sr-only">
            <Check />
          </span>
        )}
      </main>
    </AppShell>
  );
}
