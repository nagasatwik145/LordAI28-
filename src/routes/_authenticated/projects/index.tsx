import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  FolderOpen,
  Trash2,
  MoreHorizontal,
  Pencil,
  Pin,
  Archive,
  RefreshCw,
  Copy,
  Search,
  X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/lord/AppShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  useProjects,
  useCreateProject,
  useDeleteProject,
  useUpdateProject,
  recordProjectActivity,
} from "@/lib/brain/projects";
import type { Database } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/use-current-user";

const COLORS = [
  "#3b82f6",
  "#a855f7",
  "#22c55e",
  "#f97316",
  "#ec4899",
  "#6366f1",
  "#14b8a6",
  "#ef4444",
  "#eab308",
  "#64748b",
];

const ICONS = ["folder", "bot", "book", "briefcase", "grad", "brain", "code", "star"];

export const Route = createFileRoute("/_authenticated/projects/")({
  head: () => ({
    meta: [
      { title: "LORD — Projects" },
      { name: "description", content: "Manage your AI workspace projects." },
    ],
  }),
  component: ProjectsPage,
});

function ProjectsPage() {
  const { user } = useCurrentUser();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  const [icon, setIcon] = useState(ICONS[0]);
  const [filter, setFilter] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [sortBy, setSortBy] = useState<"recent" | "name">("recent");
  const [renameProject, setRenameProject] = useState<{ id: string; name: string } | null>(null);

  const projectsQuery = useProjects(user?.id);
  const { data: projects, isLoading, isError, error, refetch, isFetching } = projectsQuery;
  const createProject = useCreateProject(user?.id);
  const deleteProject = useDeleteProject(user?.id);
  const updateProject = useUpdateProject(user?.id);
  const qc = useQueryClient();

  const handleCreate = async () => {
    if (!name.trim() || !user?.id) return;
    try {
      const project = await createProject.mutateAsync({
        name: name.trim(),
        description: description.trim() || undefined,
        color,
        icon,
      });
      toast.success("Project created");
      setName("");
      setDescription("");
      setColor(COLORS[0]);
      setIcon(ICONS[0]);
      setOpen(false);
      await recordProjectActivity({
        projectId: project.id,
        userId: user.id,
        action: "created_project",
        entityType: "project",
        entityId: project.id,
      });
    } catch {
      toast.error("Failed to create project");
    }
  };

  const handleDelete = async (id: string) => {
    if (!user?.id) return;
    try {
      await deleteProject.mutateAsync(id);
      toast.success("Project deleted");
    } catch {
      toast.error("Failed to delete project");
    }
  };

  const togglePin = async (project: { id: string; is_pinned: boolean }) => {
    if (!user?.id) return;
    try {
      await updateProject.mutateAsync({ id: project.id, patch: { is_pinned: !project.is_pinned } });
    } catch {
      toast.error("Failed to update project");
    }
  };

  const visibleProjects = (projects ?? [])
    .filter((project) => project.is_archived === showArchived)
    .filter((project) =>
      `${project.name} ${project.description ?? ""}`.toLowerCase().includes(filter.toLowerCase()),
    )
    .sort((a, b) =>
      sortBy === "name"
        ? a.name.localeCompare(b.name)
        : Number(b.is_pinned) - Number(a.is_pinned) ||
          b.last_accessed_at.localeCompare(a.last_accessed_at),
    );

  const duplicateProject = async (project: NonNullable<typeof projects>[number]) => {
    try {
      const copy = await createProject.mutateAsync({
        name: `${project.name} copy`,
        description: project.description ?? undefined,
        color: project.color,
        icon: project.icon,
      });
      toast.success("Project duplicated");
      window.location.assign(`/projects/${copy.id}`);
    } catch {
      toast.error("Could not duplicate project");
    }
  };

  const saveRename = async () => {
    if (!renameProject || !renameProject.name.trim()) return;
    try {
      await updateProject.mutateAsync({
        id: renameProject.id,
        patch: { name: renameProject.name.trim() },
      });
      setRenameProject(null);
      toast.success("Project renamed");
    } catch {
      toast.error("Could not rename project");
    }
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white">Projects</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Your AI workspaces. Everything lives inside a project.
            </p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="h-4 w-4" /> New Project
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Project</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="My Project"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <textarea
                    id="description"
                    className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="What's this project about?"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Color</Label>
                  <div className="flex gap-2">
                    {COLORS.map((c) => (
                      <button
                        key={c}
                        onClick={() => setColor(c)}
                        className={cn(
                          "h-8 w-8 rounded-full border-2 transition-all",
                          color === c ? "border-white scale-110" : "border-transparent",
                        )}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Icon</Label>
                  <div className="flex gap-2">
                    {ICONS.map((i) => (
                      <Button
                        key={i}
                        variant={icon === i ? "secondary" : "ghost"}
                        size="sm"
                        onClick={() => setIcon(i)}
                      >
                        {i}
                      </Button>
                    ))}
                  </div>
                </div>
                <Button onClick={handleCreate} disabled={!name.trim()} className="w-full">
                  Create Project
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Search projects"
              className="pl-9 pr-9"
              placeholder="Search projects…"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
            {filter && (
              <button
                aria-label="Clear search"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                onClick={() => setFilter("")}
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant={showArchived ? "secondary" : "outline"}
              onClick={() => setShowArchived(!showArchived)}
            >
              {showArchived ? "Archived" : "Recent projects"}
            </Button>
            <select
              aria-label="Sort projects"
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value as "recent" | "name")}
              className="rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="recent">Recently active</option>
              <option value="name">Name</option>
            </select>
          </div>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i} className="h-40 animate-pulse bg-muted/50" />
            ))}
          </div>
        ) : isError ? (
          <Card className="flex flex-col items-center justify-center gap-3 py-20 text-center">
            <p className="text-sm text-destructive">
              Could not load projects:{" "}
              {error instanceof Error ? error.message : "The project request failed."}
            </p>
            <Button
              variant="outline"
              onClick={() => void refetch()}
              disabled={isFetching}
              className="gap-2"
            >
              <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
              {isFetching ? "Retrying…" : "Retry"}
            </Button>
          </Card>
        ) : visibleProjects.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visibleProjects.map((project) => (
              <Card
                key={project.id}
                className="group relative cursor-pointer transition-all hover:border-primary/50 hover:shadow-lg"
                onClick={() => window.location.assign(`/projects/${project.id}`)}
              >
                <div className="flex items-start justify-between p-5">
                  <div className="flex items-center gap-3">
                    <div
                      className="flex h-10 w-10 items-center justify-center rounded-lg text-white"
                      style={{ backgroundColor: project.color }}
                    >
                      <FolderOpen className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-white group-hover:text-primary transition-colors">
                        {project.name}
                      </h3>
                      <p className="text-xs text-muted-foreground line-clamp-1">
                        {project.description ?? "No description"}
                      </p>
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          setRenameProject({ id: project.id, name: project.name });
                        }}
                      >
                        <Pencil className="mr-2 h-4 w-4" />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          void duplicateProject(project);
                        }}
                      >
                        <Copy className="mr-2 h-4 w-4" />
                        Duplicate
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          togglePin(project);
                        }}
                      >
                        <Pin className="mr-2 h-4 w-4" />
                        {project.is_pinned ? "Unpin" : "Pin"}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          void updateProject
                            .mutateAsync({
                              id: project.id,
                              patch: { is_archived: !project.is_archived },
                            })
                            .then(() =>
                              toast.success(
                                project.is_archived ? "Project restored" : "Project archived",
                              ),
                            )
                            .catch(() => toast.error("Could not update project"));
                        }}
                      >
                        <Archive className="mr-2 h-4 w-4" />
                        {project.is_archived ? "Restore" : "Archive"}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(project.id);
                        }}
                        className="text-destructive"
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete permanently
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <div className="px-5 pb-4">
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span>Updated {new Date(project.updated_at).toLocaleDateString()}</span>
                    {project.is_pinned && <span className="text-yellow-500">Pinned</span>}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="flex flex-col items-center justify-center py-20">
            <FolderOpen className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold text-white mb-1">
              {showArchived
                ? "No archived projects"
                : filter
                  ? "No matching projects"
                  : "No projects yet"}
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              Create your first project to start building your AI workspace.
            </p>
            <Button onClick={() => setOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" /> Create Project
            </Button>
          </Card>
        )}
      </div>
      <Dialog
        open={!!renameProject}
        onOpenChange={(value) => {
          if (!value) setRenameProject(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename project</DialogTitle>
          </DialogHeader>
          <Input
            aria-label="Project name"
            value={renameProject?.name ?? ""}
            onChange={(event) =>
              setRenameProject((current) =>
                current ? { ...current, name: event.target.value } : current,
              )
            }
            onKeyDown={(event) => {
              if (event.key === "Enter") void saveRename();
            }}
          />
          <Button onClick={() => void saveRename()} disabled={!renameProject?.name.trim()}>
            Save name
          </Button>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
