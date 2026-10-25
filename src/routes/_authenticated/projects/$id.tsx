import { createFileRoute, Link, useParams, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  ArrowLeft,
  MessageSquare,
  BookOpen,
  StickyNote,
  ListTodo,
  Brain,
  FolderOpen,
  Plus,
  MoreHorizontal,
  FileText,
  Search,
  Upload,
  Download,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/lord/AppShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  useProject,
  useProjectNotes,
  useProjectTasks,
  useCreateNote,
  useUpdateNote,
  useDeleteNote,
  useCreateTask,
  useUpdateTask,
  useDeleteTask,
  useProjectActivity,
} from "@/lib/brain/projects";
import { useMemories } from "@/lib/memory";
import { useCurrentUser } from "@/hooks/use-current-user";
import { supabase } from "@/integrations/supabase/client";
import { validateProjectFile } from "@/lib/brain/project-validation";

const TABS = [
  { id: "overview", label: "Overview", icon: FolderOpen },
  { id: "chats", label: "Chats", icon: MessageSquare },
  { id: "documents", label: "Documents", icon: FileText },
  { id: "files", label: "Files", icon: BookOpen },
  { id: "notes", label: "Notes", icon: StickyNote },
  { id: "tasks", label: "Tasks", icon: ListTodo },
  { id: "memories", label: "Memories", icon: Brain },
] as const;

export const Route = createFileRoute("/_authenticated/projects/$id")({
  head: () => ({
    meta: [{ title: "LORD — Project" }, { name: "description", content: "Project workspace." }],
  }),
  component: ProjectWorkspace,
});

function ProjectWorkspace() {
  const { id } = useParams({ from: "/_authenticated/projects/$id" });
  const { user } = useCurrentUser();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState("overview");
  const [newNoteTitle, setNewNoteTitle] = useState("");
  const [newNoteContent, setNewNoteContent] = useState("");
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskDueDate, setNewTaskDueDate] = useState("");
  const [resourceSearch, setResourceSearch] = useState("");
  const [saveState, setSaveState] = useState<Record<string, string>>({});

  const { data: project, isLoading: projectLoading } = useProject(user?.id ?? null, id);
  const { data: notes } = useProjectNotes(user?.id ?? null, id);
  const { data: tasks } = useProjectTasks(user?.id ?? null, id);
  const { data: memories } = useMemories(user?.id ?? null);
  const { data: activity } = useProjectActivity(user?.id ?? null, id);
  const { data: conversations } = useQuery({
    queryKey: ["project-conversations", user?.id, id],
    enabled: !!user?.id && !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conversations")
        .select("id,title,updated_at,last_message_at")
        .eq("user_id", user!.id)
        .eq("project_id", id)
        .is("deleted_at", null)
        .order("last_message_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: unlinkedConversations, refetch: refetchUnlinked } = useQuery({
    queryKey: ["unlinked-conversations", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conversations")
        .select("id,title,last_message_at")
        .eq("user_id", user!.id)
        .is("project_id", null)
        .is("deleted_at", null)
        .order("last_message_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: sources, refetch: refetchSources } = useQuery({
    queryKey: ["project-sources", user?.id, id],
    enabled: !!user?.id && !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("knowledge_sources")
        .select(
          "id,name,mime_type,file_size_bytes,storage_path,processing_status,created_at,source_type",
        )
        .eq("user_id", user!.id)
        .eq("project_id", id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const createNote = useCreateNote(user?.id ?? null, id);
  const updateNote = useUpdateNote(user?.id ?? null, id);
  const deleteNote = useDeleteNote(user?.id ?? null, id);
  const createTask = useCreateTask(user?.id ?? null, id);
  const updateTask = useUpdateTask(user?.id ?? null, id);
  const deleteTask = useDeleteTask(user?.id ?? null, id);

  const visibleNotes = useMemo(
    () =>
      (notes ?? []).filter((note) =>
        `${note.title} ${note.content}`.toLowerCase().includes(resourceSearch.toLowerCase()),
      ),
    [notes, resourceSearch],
  );
  const visibleTasks = useMemo(
    () =>
      (tasks ?? []).filter((task) =>
        `${task.title} ${task.description ?? ""}`
          .toLowerCase()
          .includes(resourceSearch.toLowerCase()),
      ),
    [tasks, resourceSearch],
  );
  const visibleSources = useMemo(
    () =>
      (sources ?? []).filter((source) =>
        source.name.toLowerCase().includes(resourceSearch.toLowerCase()),
      ),
    [sources, resourceSearch],
  );

  const saveNoteField = (
    note: NonNullable<typeof notes>[number],
    patch: { title?: string; content?: string },
  ) => {
    setSaveState((current) => ({ ...current, [note.id]: "Saving…" }));
    const timers = window as typeof window & { __projectNoteTimers?: Record<string, number> };
    timers.__projectNoteTimers ??= {};
    window.clearTimeout(timers.__projectNoteTimers[note.id]);
    timers.__projectNoteTimers[note.id] = window.setTimeout(() => {
      void updateNote
        .mutateAsync({ id: note.id, expectedUpdatedAt: note.updatedAt, patch })
        .then(() => setSaveState((s) => ({ ...s, [note.id]: "Saved" })))
        .catch((error) =>
          setSaveState((s) => ({
            ...s,
            [note.id]:
              error instanceof Error && error.message.includes("changed elsewhere")
                ? "Changed in another session. Reload this project to keep editing."
                : "Save failed. Edit again to retry.",
          })),
        );
    }, 650);
  };

  const uploadProjectFile = async (file?: File) => {
    if (!file || !user?.id) return;
    const validationError = validateProjectFile(file);
    if (validationError) {
      toast.error(validationError);
      return;
    }
    const path = `${user.id}/${id}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    try {
      const { error: uploadError } = await supabase.storage
        .from("project-files")
        .upload(path, file, { contentType: file.type });
      if (uploadError) throw uploadError;
      const { error } = await supabase.from("knowledge_sources").insert({
        user_id: user.id,
        project_id: id,
        name: file.name,
        source_type: "file",
        storage_path: path,
        mime_type: file.type,
        file_size_bytes: file.size,
        processing_status: "stored",
      });
      if (error) {
        await supabase.storage.from("project-files").remove([path]);
        throw error;
      }
      await refetchSources();
      toast.success("File added to project");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not upload file");
    }
  };

  const downloadSource = async (path: string) => {
    const { data, error } = await supabase.storage.from("project-files").createSignedUrl(path, 60);
    if (error || !data?.signedUrl) {
      toast.error("Could not open this file");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const exportProject = () => {
    if (!project) return;
    const payload = {
      project,
      notes: notes ?? [],
      tasks: tasks ?? [],
      conversations: conversations ?? [],
      files: sources ?? [],
      activity: activity ?? [],
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${project.name.replace(/[^a-z0-9-_]/gi, "-")}-workspace.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const linkConversation = async (conversationId: string) => {
    if (!user?.id) return;
    const { error } = await supabase
      .from("conversations")
      .update({ project_id: id })
      .eq("id", conversationId)
      .eq("user_id", user.id)
      .is("project_id", null);
    if (error) {
      toast.error("Could not link conversation");
      return;
    }
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["project-conversations", user.id, id] }),
      refetchUnlinked(),
    ]);
    toast.success("Conversation linked to project");
  };

  const handleCreateNote = async () => {
    if (!newNoteTitle.trim() || !user?.id) return;
    try {
      await createNote.mutateAsync({ title: newNoteTitle.trim(), content: newNoteContent.trim() });
      setNewNoteTitle("");
      setNewNoteContent("");
      toast.success("Note created");
    } catch {
      toast.error("Failed to create note");
    }
  };

  const handleCreateTask = async () => {
    if (!newTaskTitle.trim() || !user?.id) return;
    try {
      await createTask.mutateAsync({
        title: newTaskTitle.trim(),
        dueDate: newTaskDueDate ? new Date(`${newTaskDueDate}T23:59:59`).toISOString() : undefined,
      });
      setNewTaskTitle("");
      setNewTaskDueDate("");
      toast.success("Task created");
    } catch {
      toast.error("Failed to create task");
    }
  };

  const toggleTaskStatus = async (task: { id: string; status: string }) => {
    const newStatus = task.status === "done" ? "todo" : "done";
    try {
      await updateTask.mutateAsync({ id: task.id, patch: { status: newStatus } });
    } catch {
      toast.error("Failed to update task");
    }
  };

  if (projectLoading) {
    return (
      <AppShell>
        <div className="mx-auto max-w-6xl px-4 py-8">
          <div className="animate-pulse space-y-4">
            <div className="h-8 w-48 rounded bg-muted" />
            <div className="h-64 rounded bg-muted" />
          </div>
        </div>
      </AppShell>
    );
  }

  if (!project) {
    return (
      <AppShell>
        <div className="mx-auto max-w-6xl px-4 py-20 text-center">
          <h2 className="text-xl font-semibold text-white mb-2">Project not found</h2>
          <Button onClick={() => navigate({ to: "/projects" })}>Back to Projects</Button>
        </div>
      </AppShell>
    );
  }

  const projectMemories =
    memories?.filter((m) => {
      if (!id) return true;
      return !m.project_id || m.project_id === id;
    }) ?? [];

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6 flex flex-wrap items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/projects" })}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Projects
          </Button>
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-lg text-white"
              style={{ backgroundColor: project.color }}
            >
              <FolderOpen className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">{project.name}</h1>
              <p className="text-sm text-muted-foreground">
                {project.description ?? "No description"}
              </p>
            </div>
          </div>
          <Button className="ml-auto" variant="outline" size="sm" onClick={exportProject}>
            Export project
          </Button>
        </div>

        <div className="relative mb-4 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search project resources"
            className="pl-9"
            placeholder="Search notes, tasks, and files"
            value={resourceSearch}
            onChange={(event) => setResourceSearch(event.target.value)}
          />
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid h-auto w-full grid-cols-3 gap-1 sm:grid-cols-4 lg:grid-cols-7">
            {TABS.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id} className="gap-2">
                <tab.icon className="h-4 w-4" />
                <span className="hidden sm:inline">{tab.label}</span>
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <StatCard title="Notes" value={notes?.length ?? 0} icon={StickyNote} />
              <StatCard title="Tasks" value={tasks?.length ?? 0} icon={ListTodo} />
              <StatCard title="Files" value={sources?.length ?? 0} icon={FileText} />
              <StatCard title="Chats" value={conversations?.length ?? 0} icon={MessageSquare} />
              <StatCard title="Memories" value={projectMemories.length} icon={Brain} />
            </div>
            {activity && activity.length > 0 && (
              <Card className="p-5">
                <h3 className="mb-4 font-semibold text-white">Recent Activity</h3>
                <div className="space-y-3">
                  {activity.slice(0, 10).map((a) => (
                    <div key={a.id} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{a.action}</span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(a.createdAt).toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="chats" className="space-y-4">
            <Card className="p-5">
              <h3 className="mb-4 font-semibold text-white">Project Chats</h3>
              <p className="text-sm text-muted-foreground">
                Chats opened here use relevant project notes and indexed knowledge as LORD context.
              </p>
              <Button asChild className="mt-4 gap-2">
                <Link to="/chat" search={{ projectId: id }}>
                  <Plus className="h-4 w-4" /> New Chat
                </Link>
              </Button>
              <div className="mt-5 space-y-2">
                {conversations?.map((chat) => (
                  <Link
                    key={chat.id}
                    to="/chat"
                    search={{ conversationId: chat.id, projectId: id }}
                    className="flex items-center justify-between rounded-lg border border-border/50 p-3 hover:border-primary/50"
                  >
                    <span className="truncate text-sm text-white">
                      {chat.title || "Untitled conversation"}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {chat.last_message_at
                        ? new Date(chat.last_message_at).toLocaleDateString()
                        : ""}
                    </span>
                  </Link>
                ))}
                {conversations?.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No conversations linked to this project yet.
                  </p>
                )}
              </div>
              {!!unlinkedConversations?.length && (
                <details className="mt-5">
                  <summary className="cursor-pointer text-sm text-primary">
                    Link an existing conversation
                  </summary>
                  <div className="mt-2 max-h-56 space-y-2 overflow-auto">
                    {unlinkedConversations.map((chat) => (
                      <div
                        key={chat.id}
                        className="flex items-center justify-between gap-3 rounded border border-border/50 p-2"
                      >
                        <span className="truncate text-sm">
                          {chat.title || "Untitled conversation"}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void linkConversation(chat.id)}
                        >
                          Link
                        </Button>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </Card>
          </TabsContent>

          <TabsContent value="documents" className="space-y-4">
            <Card className="p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-white">Project documents</h3>
                  <p className="text-sm text-muted-foreground">
                    Private files use owner-scoped storage. Indexed text can be used for project
                    answers.
                  </p>
                </div>
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
                  <Upload className="h-4 w-4" />
                  Upload file
                  <input
                    className="sr-only"
                    type="file"
                    accept=".pdf,.txt,.md,.png,.jpg,.jpeg,.webp"
                    onChange={(event) => {
                      void uploadProjectFile(event.target.files?.[0]);
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
              </div>
              <div className="mt-5 space-y-2">
                {visibleSources.map((source) => (
                  <div
                    key={source.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border/50 p-3"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <FileText className="h-4 w-4 shrink-0 text-primary" />
                      <div className="min-w-0">
                        <p className="truncate text-sm text-white">{source.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {(source.file_size_bytes / 1024 / 1024).toFixed(2)} MB ·{" "}
                          {source.processing_status}
                        </p>
                      </div>
                    </div>
                    {source.storage_path && (
                      <Button
                        aria-label={`Download ${source.name}`}
                        variant="ghost"
                        size="icon"
                        onClick={() => void downloadSource(source.storage_path!)}
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
                {sources?.length === 0 && (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    No documents in this project yet.
                  </p>
                )}
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="files">
            <Card className="p-5">
              <h3 className="font-semibold text-white">Project files</h3>
              <div className="mt-4 space-y-2">
                {visibleSources.map((source) => (
                  <button
                    key={source.id}
                    onClick={() => source.storage_path && void downloadSource(source.storage_path)}
                    className="flex w-full items-center gap-3 rounded-lg border border-border/50 p-3 text-left hover:border-primary/50"
                  >
                    <FileText className="h-4 w-4 text-primary" />
                    <span className="min-w-0 flex-1 truncate text-sm text-white">
                      {source.name}
                    </span>
                    <Download className="h-4 w-4 text-muted-foreground" />
                  </button>
                ))}
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="notes" className="space-y-4">
            <Card className="p-5">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="font-semibold text-white">Notes</h3>
              </div>
              <div className="mb-4 space-y-2">
                <Input
                  placeholder="Note title"
                  value={newNoteTitle}
                  onChange={(e) => setNewNoteTitle(e.target.value)}
                />
                <Textarea
                  placeholder="Write your note..."
                  value={newNoteContent}
                  onChange={(e) => setNewNoteContent(e.target.value)}
                />
                <Button onClick={handleCreateNote} disabled={!newNoteTitle.trim()} size="sm">
                  Add Note
                </Button>
              </div>
              <div className="space-y-3">
                {visibleNotes.map((note) => (
                  <Card key={note.id} className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="min-w-0 flex-1 space-y-2 pr-3">
                        <Input
                          aria-label="Note title"
                          defaultValue={note.title}
                          onChange={(event) => saveNoteField(note, { title: event.target.value })}
                        />
                        <Textarea
                          aria-label="Note content"
                          defaultValue={note.content}
                          onChange={(event) => saveNoteField(note, { content: event.target.value })}
                        />
                        <p className="text-xs text-muted-foreground" aria-live="polite">
                          {saveState[note.id] ?? "Saved"}
                        </p>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() =>
                              updateNote.mutate({
                                id: note.id,
                                patch: { isPinned: !note.isPinned },
                              })
                            }
                          >
                            {note.isPinned ? "Unpin" : "Pin"}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => deleteNote.mutate(note.id)}
                            className="text-destructive"
                          >
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </Card>
                ))}
                {notes?.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No notes yet. Create your first note above.
                  </p>
                )}
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="tasks" className="space-y-4">
            <Card className="p-5">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="font-semibold text-white">Tasks</h3>
              </div>
              <div className="mb-4 flex flex-col gap-2 sm:flex-row">
                <Input
                  placeholder="Task title"
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreateTask()}
                />
                <Input aria-label="Task due date" type="date" className="sm:max-w-44" value={newTaskDueDate} onChange={(e) => setNewTaskDueDate(e.target.value)} />
                <Button onClick={handleCreateTask} disabled={!newTaskTitle.trim()}>
                  Add
                </Button>
              </div>
              <div className="space-y-2">
                {visibleTasks.map((task) => (
                  <Card
                    key={task.id}
                    className={cn(
                      "flex items-center justify-between p-3 cursor-pointer transition-colors",
                      task.status === "done" && "opacity-60",
                    )}
                    onClick={() => toggleTaskStatus(task)}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={cn(
                          "h-4 w-4 rounded border-2 flex items-center justify-center",
                          task.status === "done"
                            ? "bg-primary border-primary"
                            : "border-muted-foreground",
                        )}
                      >
                        {task.status === "done" && (
                          <span className="text-[10px] text-primary-foreground">✓</span>
                        )}
                      </div>
                      <span
                        className={cn(
                          "text-sm",
                          task.status === "done" && "line-through text-muted-foreground",
                        )}
                      >
                        {task.title}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "text-xs px-2 py-0.5 rounded-full",
                          getPriorityStyles(task.priority),
                        )}
                      >
                        {task.priority}
                      </span>
                      {task.dueDate && <span className="text-xs text-muted-foreground">Due {new Date(task.dueDate).toLocaleDateString()}</span>}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() =>
                              updateTask.mutate({
                                id: task.id,
                                patch: { status: task.status === "done" ? "todo" : "done" },
                              })
                            }
                          >
                            {task.status === "done" ? "Mark as todo" : "Mark as done"}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => deleteTask.mutate(task.id)}
                            className="text-destructive"
                          >
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </Card>
                ))}
                {tasks?.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No tasks yet. Add your first task above.
                  </p>
                )}
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="memories" className="space-y-4">
            <Card className="p-5">
              <h3 className="mb-4 font-semibold text-white">Project Memories</h3>
              <div className="space-y-3">
                {projectMemories.map((memory) => (
                  <div
                    key={memory.id}
                    className="flex items-start justify-between rounded-lg border border-border/50 p-3"
                  >
                    <div>
                      <p className="text-sm text-white line-clamp-2">{memory.content}</p>
                      <span className="text-xs text-muted-foreground">{memory.category}</span>
                    </div>
                    {memory.pinned && <span className="text-xs text-yellow-500">Pinned</span>}
                  </div>
                ))}
                {projectMemories.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No memories for this project yet. Memories are created automatically during
                    conversations.
                  </p>
                )}
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}

function StatCard({
  title,
  value,
  icon: Icon,
}: {
  title: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="text-2xl font-bold text-white">{value}</p>
        </div>
        <Icon className="h-8 w-8 text-muted-foreground" />
      </div>
    </Card>
  );
}

function getPriorityStyles(priority: string): string {
  switch (priority) {
    case "high":
      return "bg-red-500/20 text-red-400";
    case "medium":
      return "bg-yellow-500/20 text-yellow-400";
    case "low":
      return "bg-green-500/20 text-green-400";
    default:
      return "bg-muted text-muted-foreground";
  }
}
