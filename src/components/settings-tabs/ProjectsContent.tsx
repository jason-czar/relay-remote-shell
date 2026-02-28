import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, FolderOpen, ArrowRight, Trash2, Search } from "lucide-react";
import { ProjectsSkeleton } from "@/components/LoadingSkeletons";
import type { Tables } from "@/integrations/supabase/types";
import { projectNameSchema } from "@/lib/validations";

export default function ProjectsContent() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [projects, setProjects] = useState<Tables<"projects">[]>([]);
  const [newName, setNewName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [nameError, setNameError] = useState("");

  const loadProjects = async () => {
    const { data } = await supabase.from("projects").select("*").order("created_at", { ascending: false });
    setProjects(data ?? []);
    setInitialLoading(false);
  };

  useEffect(() => { if (user) loadProjects(); }, [user]);

  const createProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const result = projectNameSchema.safeParse(newName);
    if (!result.success) { setNameError(result.error.issues[0].message); return; }
    setNameError("");
    setLoading(true);
    const { error } = await supabase.from("projects").insert({ name: result.data, owner_id: user.id });
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); }
    else { toast({ title: "Project created" }); setNewName(""); setOpen(false); loadProjects(); }
    setLoading(false);
  };

  const deleteProject = async (id: string) => {
    const { error } = await supabase.from("projects").delete().eq("id", id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); }
    else loadProjects();
  };

  if (initialLoading) return <ProjectsSkeleton />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="heading-2">Projects</h2>
          <p className="body-sm text-muted-foreground">Manage your relay projects</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2"><Plus className="h-4 w-4" /> New Project</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create Project</DialogTitle></DialogHeader>
            <form onSubmit={createProject} className="space-y-4">
              <div>
                <Input placeholder="Project name" value={newName} onChange={(e) => { setNewName(e.target.value); setNameError(""); }} required maxLength={100} />
                {nameError && <p className="text-xs text-destructive mt-1">{nameError}</p>}
              </div>
              <Button type="submit" className="w-full" disabled={loading}>{loading ? "Creating..." : "Create"}</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {projects.length > 0 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search projects..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-9 max-w-sm" />
        </div>
      )}

      {projects.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FolderOpen className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold">No projects</h3>
            <p className="text-sm text-muted-foreground">Create your first project to get started</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.filter((p) => p.name.toLowerCase().includes(searchQuery.toLowerCase())).map((project) => (
            <Card key={project.id} className="cursor-pointer hover:border-primary/50 transition-colors" onClick={() => navigate(`/project/${project.id}`)}>
              <CardHeader className="flex flex-row items-start justify-between">
                <div>
                  <CardTitle className="text-base">{project.name}</CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">Created {new Date(project.created_at).toLocaleDateString()}</p>
                </div>
                {project.owner_id === user?.id && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={(e) => e.stopPropagation()}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete project?</AlertDialogTitle>
                        <AlertDialogDescription>This will permanently delete "{project.name}" and all its devices and sessions. This action cannot be undone.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => deleteProject(project.id)}>Delete</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-1 text-sm text-primary">Open <ArrowRight className="h-3 w-3" /></div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
