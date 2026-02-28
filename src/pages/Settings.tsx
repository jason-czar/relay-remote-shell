import { useEffect, useState, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AppLayout } from "@/components/AppLayout";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Camera, User, Lock, Save, RotateCcw, Timer, Trash2, MessageSquare, LayoutDashboard, FolderOpen, Monitor, Plug, BookOpen } from "lucide-react";
import { getThinkingPanelEnabled, setThinkingPanelEnabled } from "@/hooks/useThinkingPanel";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import type { Tables } from "@/integrations/supabase/types";
import { displayNameSchema, passwordSchema } from "@/lib/validations";
import { resetOnboardingTour } from "@/components/OnboardingTour";
import { getInactivitySettings, saveInactivitySettings, type InactivitySettings } from "@/hooks/useInactivityTimeout";

// Embedded sub-pages (stripped of AppLayout wrapper)
import DashboardContent from "@/components/settings-tabs/DashboardContent";
import ProjectsContent from "@/components/settings-tabs/ProjectsContent";
import DevicesContent from "@/components/settings-tabs/DevicesContent";
import PrivaClawContent from "@/components/settings-tabs/PrivaClawContent";
import DocsContent from "@/components/settings-tabs/DocsContent";

const TABS = [
  { value: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { value: "projects",  label: "Projects",  icon: FolderOpen },
  { value: "devices",   label: "Devices",   icon: Monitor },
  { value: "privaclaw", label: "PrivaClaw", icon: Plug },
  { value: "docs",      label: "Docs",      icon: BookOpen },
  { value: "profile",   label: "Profile",   icon: User },
] as const;

type TabValue = typeof TABS[number]["value"];

export default function Settings() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab") as TabValue | null;
  const [activeTab, setActiveTab] = useState<TabValue>(
    TABS.some(t => t.value === tabParam) ? tabParam! : "dashboard"
  );

  const handleTabChange = (val: string) => {
    const v = val as TabValue;
    setActiveTab(v);
    setSearchParams({ tab: v }, { replace: true });
  };

  // Profile tab state
  const { user, signOut } = useAuth();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [profile, setProfile] = useState<Tables<"profiles"> | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  const [timeoutSettings, setTimeoutSettings] = useState<InactivitySettings>(getInactivitySettings);
  const [showThinking, setShowThinkingState] = useState(getThinkingPanelEnabled);
  const [deletingAccount, setDeletingAccount] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("profiles")
      .select("*")
      .eq("user_id", user.id)
      .single()
      .then(({ data }) => {
        if (data) {
          setProfile(data);
          setDisplayName(data.display_name ?? "");
          setAvatarUrl(data.avatar_url);
        }
      });
  }, [user]);

  const getAvatarPublicUrl = (path: string) => {
    const { data } = supabase.storage.from("avatars").getPublicUrl(path);
    return data.publicUrl;
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Invalid file", description: "Please upload an image file", variant: "destructive" });
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast({ title: "File too large", description: "Avatar must be under 2MB", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const ext = file.name.split(".").pop();
      const filePath = `${user.id}/avatar.${ext}`;
      const { error: uploadErr } = await supabase.storage.from("avatars").upload(filePath, file, { upsert: true });
      if (uploadErr) throw uploadErr;
      const publicUrl = getAvatarPublicUrl(filePath);
      const urlWithCacheBuster = `${publicUrl}?t=${Date.now()}`;
      const { error: updateErr } = await supabase.from("profiles").update({ avatar_url: urlWithCacheBuster }).eq("user_id", user.id);
      if (updateErr) throw updateErr;
      setAvatarUrl(urlWithCacheBuster);
      toast({ title: "Avatar updated" });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const handleSaveProfile = async () => {
    if (!user) return;
    const result = displayNameSchema.safeParse(displayName);
    if (!result.success) {
      toast({ title: "Validation error", description: result.error.issues[0].message, variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from("profiles").update({ display_name: displayName.trim() || null }).eq("user_id", user.id);
      if (error) throw error;
      toast({ title: "Profile saved" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const passResult = passwordSchema.safeParse(newPassword);
    if (!passResult.success) {
      toast({ title: "Invalid password", description: passResult.error.issues[0].message, variant: "destructive" });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: "Passwords don't match", variant: "destructive" });
      return;
    }
    setChangingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      toast({ title: "Password updated" });
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setChangingPassword(false);
    }
  };

  const handleDeleteAccount = async () => {
    setDeletingAccount(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await supabase.functions.invoke("delete-account", {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (res.error) throw res.error;
      await signOut();
    } catch (err: any) {
      toast({ title: "Error deleting account", description: err.message, variant: "destructive" });
      setDeletingAccount(false);
    }
  };

  const initials = (displayName || user?.email || "U")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <AppLayout>
      <div className="space-y-6 h-full flex flex-col">
        <div>
          <h1 className="heading-1">Settings</h1>
          <p className="body-sm text-muted-foreground">Manage your workspace</p>
        </div>

        <Tabs value={activeTab} onValueChange={handleTabChange} className="flex-1 flex flex-col min-h-0">
          <TabsList className="h-auto flex-wrap gap-1 bg-muted/50 p-1 w-full justify-start">
            {TABS.map(({ value, label, icon: Icon }) => (
              <TabsTrigger
                key={value}
                value={value}
                className="flex items-center gap-1.5 text-sm px-3 py-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm"
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="dashboard" className="flex-1 mt-4 min-h-0 overflow-auto">
            <DashboardContent />
          </TabsContent>

          <TabsContent value="projects" className="flex-1 mt-4 min-h-0 overflow-auto">
            <ProjectsContent />
          </TabsContent>

          <TabsContent value="devices" className="flex-1 mt-4 min-h-0 overflow-auto">
            <DevicesContent />
          </TabsContent>

          <TabsContent value="privaclaw" className="flex-1 mt-4 min-h-0 overflow-auto">
            <PrivaClawContent />
          </TabsContent>

          <TabsContent value="docs" className="flex-1 mt-4 min-h-0 overflow-auto">
            <DocsContent />
          </TabsContent>

          <TabsContent value="profile" className="flex-1 mt-4 min-h-0 overflow-auto">
            <div className="max-w-2xl space-y-6">
              {/* Avatar + Display Name */}
              <Card>
                <CardHeader>
                  <CardTitle className="heading-4 flex items-center gap-2">
                    <User className="h-4 w-4" /> Profile
                  </CardTitle>
                  <CardDescription className="body-sm">Your public display information</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="flex items-center gap-6">
                    <div className="relative group">
                      <Avatar className="h-20 w-20">
                        <AvatarImage src={avatarUrl ?? undefined} alt={displayName} />
                        <AvatarFallback className="text-lg bg-primary/10 text-primary">{initials}</AvatarFallback>
                      </Avatar>
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploading}
                        className="absolute inset-0 flex items-center justify-center rounded-full bg-background/80 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Camera className="h-5 w-5 text-foreground" />
                      </button>
                      <input ref={fileInputRef} type="file" accept="image/*" onChange={handleAvatarUpload} className="hidden" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-medium">Profile photo</p>
                      <p className="text-xs text-muted-foreground">{uploading ? "Uploading..." : "Click the avatar to upload. Max 2MB."}</p>
                    </div>
                  </div>
                  <Separator />
                  <div className="space-y-2">
                    <Label htmlFor="displayName">Display name</Label>
                    <Input id="displayName" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Your display name" maxLength={100} />
                  </div>
                  <div className="space-y-2">
                    <Label>Email</Label>
                    <Input value={user?.email ?? ""} disabled className="opacity-60" />
                    <p className="text-xs text-muted-foreground">Email cannot be changed</p>
                  </div>
                  <Button onClick={handleSaveProfile} disabled={saving} className="gap-2">
                    <Save className="h-4 w-4" />
                    {saving ? "Saving..." : "Save Profile"}
                  </Button>
                </CardContent>
              </Card>

              {/* Change Password */}
              <Card>
                <CardHeader>
                  <CardTitle className="heading-4 flex items-center gap-2"><Lock className="h-4 w-4" /> Change Password</CardTitle>
                  <CardDescription className="body-sm">Update your account password</CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleChangePassword} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="newPassword">New password</Label>
                      <Input id="newPassword" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="••••••••" minLength={6} required />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="confirmPassword">Confirm new password</Label>
                      <Input id="confirmPassword" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="••••••••" minLength={6} required />
                    </div>
                    <Button type="submit" disabled={changingPassword} variant="outline">
                      {changingPassword ? "Updating..." : "Update Password"}
                    </Button>
                  </form>
                </CardContent>
              </Card>

              {/* Session Timeout */}
              <Card>
                <CardHeader>
                  <CardTitle className="heading-4 flex items-center gap-2"><Timer className="h-4 w-4" /> Session Timeout</CardTitle>
                  <CardDescription className="body-sm">Automatically log out after a period of inactivity</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="timeout-toggle">Enable inactivity timeout</Label>
                    <Switch
                      id="timeout-toggle"
                      checked={timeoutSettings.enabled}
                      onCheckedChange={(checked) => {
                        const next = { ...timeoutSettings, enabled: checked };
                        setTimeoutSettings(next);
                        saveInactivitySettings(next);
                        toast({ title: checked ? "Timeout enabled" : "Timeout disabled" });
                      }}
                    />
                  </div>
                  {timeoutSettings.enabled && (
                    <div className="space-y-2">
                      <Label>Timeout after</Label>
                      <Select
                        value={String(timeoutSettings.minutes)}
                        onValueChange={(val) => {
                          const next = { ...timeoutSettings, minutes: Number(val) };
                          setTimeoutSettings(next);
                          saveInactivitySettings(next);
                          toast({ title: `Timeout set to ${val} minutes` });
                        }}
                      >
                        <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {[5, 10, 15, 30, 60].map((m) => (
                            <SelectItem key={m} value={String(m)}>{m} minutes</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Chat Preferences */}
              <Card>
                <CardHeader>
                  <CardTitle className="heading-4 flex items-center gap-2"><MessageSquare className="h-4 w-4" /> Chat Preferences</CardTitle>
                  <CardDescription className="body-sm">Customize the chat interface behaviour</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label htmlFor="thinking-toggle">Show thinking / reasoning panels</Label>
                      <p className="text-xs text-muted-foreground mt-0.5">Display model reasoning steps for OpenClaw, Claude Code, and Codex responses</p>
                    </div>
                    <Switch
                      id="thinking-toggle"
                      checked={showThinking}
                      onCheckedChange={(checked) => {
                        setShowThinkingState(checked);
                        setThinkingPanelEnabled(checked);
                        toast({ title: checked ? "Thinking panels enabled" : "Thinking panels hidden" });
                      }}
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Onboarding */}
              <Card>
                <CardHeader>
                  <CardTitle className="heading-4 flex items-center gap-2"><RotateCcw className="h-4 w-4" /> Onboarding Tour</CardTitle>
                  <CardDescription className="body-sm">Restart the getting-started walkthrough</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button variant="outline" onClick={() => { resetOnboardingTour(); toast({ title: "Tour reset", description: "Visit the Dashboard to see the tour again." }); }}>
                    Restart Tour
                  </Button>
                </CardContent>
              </Card>

              {/* Danger Zone */}
              <Card className="border-destructive/30">
                <CardHeader>
                  <CardTitle className="heading-4 flex items-center gap-2 text-destructive"><Trash2 className="h-4 w-4" /> Danger Zone</CardTitle>
                  <CardDescription className="body-sm">Irreversible actions for your account</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3">
                    <div>
                      <p className="text-sm font-medium">Delete account</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Permanently delete your account and all associated data. This cannot be undone.</p>
                    </div>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="destructive" size="sm" disabled={deletingAccount}>
                          {deletingAccount ? "Deleting…" : "Delete Account"}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will permanently delete your account, all conversations, sessions, devices, and projects you own. <strong>This action cannot be undone.</strong>
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={handleDeleteAccount}>
                            Yes, delete my account
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
