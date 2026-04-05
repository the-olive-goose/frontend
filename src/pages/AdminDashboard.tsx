import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import AdminLogin from "@/components/AdminLogin";
import logo from "@/assets/logo.png";
import type { Json } from "@/integrations/supabase/types";

interface HeroSettings {
  headline: string;
  subtext: string;
  cta_text: string;
  show_countdown: boolean;
  launch_date: string | null;
}

interface Subscriber {
  id: string;
  email: string;
  subscribed_at: string;
}

const AdminDashboard = () => {
  const [session, setSession] = useState<boolean | null>(null);
  const [activeTab, setActiveTab] = useState("hero");
  const [hero, setHero] = useState<HeroSettings>({
    headline: "",
    subtext: "",
    cta_text: "",
    show_countdown: false,
    launch_date: null,
  });
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(!!session);
    });
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(!!session);
    });
    return () => subscription.unsubscribe();
  }, []);

  const loadData = useCallback(async () => {
    const [heroRes, subsRes] = await Promise.all([
      supabase.from("site_settings").select("value").eq("key", "hero").single(),
      supabase.from("subscribers").select("*").order("subscribed_at", { ascending: false }),
    ]);
    if (heroRes.data?.value) setHero(heroRes.data.value as unknown as HeroSettings);
    if (subsRes.data) setSubscribers(subsRes.data);
  }, []);

  useEffect(() => {
    if (session) loadData();
  }, [session, loadData]);

  const saveHero = async () => {
    setIsSaving(true);
    const { error } = await supabase
      .from("site_settings")
      .update({ value: hero as unknown as Json })
      .eq("key", "hero");
    setIsSaving(false);
    if (error) {
      toast({ title: "Error saving", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Saved!", description: "Hero section updated." });
    }
  };

  const deleteSubscriber = async (id: string) => {
    const { error } = await supabase.from("subscribers").delete().eq("id", id);
    if (!error) {
      setSubscribers((prev) => prev.filter((s) => s.id !== id));
      toast({ title: "Deleted" });
    }
  };

  const exportCSV = () => {
    const csv = ["Email,Subscribed At", ...subscribers.map((s) => `${s.email},${s.subscribed_at}`)].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "subscribers.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setSession(false);
  };

  if (session === null) return null;
  if (!session) return <AdminLogin onLogin={() => setSession(true)} />;

  const tabs = [
    { id: "hero", label: "Hero Section" },
    { id: "subscribers", label: "Subscribers" },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src={logo} alt="The Olive Goose" className="w-10 h-10" width={512} height={512} />
          <div>
            <h1 className="font-serif text-lg text-foreground">The Olive Goose</h1>
            <p className="text-xs text-muted-foreground font-sans">Admin Dashboard</p>
          </div>
        </div>
        <button onClick={handleLogout} className="text-sm text-muted-foreground hover:text-foreground transition-colors font-sans">
          Sign Out
        </button>
      </header>

      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Tabs */}
        <div className="flex gap-1 mb-8 border-b border-border">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2.5 text-sm font-sans transition-colors border-b-2 -mb-px ${
                activeTab === tab.id
                  ? "border-primary text-foreground font-medium"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Hero Tab */}
        {activeTab === "hero" && (
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-sans text-foreground mb-1.5">Headline</label>
              <input
                value={hero.headline}
                onChange={(e) => setHero({ ...hero, headline: e.target.value })}
                className="w-full px-4 py-3 rounded-lg border border-border bg-card text-foreground font-sans text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div>
              <label className="block text-sm font-sans text-foreground mb-1.5">Subtext</label>
              <textarea
                value={hero.subtext}
                onChange={(e) => setHero({ ...hero, subtext: e.target.value })}
                rows={3}
                className="w-full px-4 py-3 rounded-lg border border-border bg-card text-foreground font-sans text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
              />
            </div>
            <div>
              <label className="block text-sm font-sans text-foreground mb-1.5">CTA Button Text</label>
              <input
                value={hero.cta_text}
                onChange={(e) => setHero({ ...hero, cta_text: e.target.value })}
                className="w-full px-4 py-3 rounded-lg border border-border bg-card text-foreground font-sans text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="countdown"
                checked={hero.show_countdown}
                onChange={(e) => setHero({ ...hero, show_countdown: e.target.checked })}
                className="w-4 h-4 rounded border-border text-primary focus:ring-primary"
              />
              <label htmlFor="countdown" className="text-sm font-sans text-foreground">
                Show Countdown Timer
              </label>
            </div>
            {hero.show_countdown && (
              <div>
                <label className="block text-sm font-sans text-foreground mb-1.5">Launch Date</label>
                <input
                  type="datetime-local"
                  value={hero.launch_date || ""}
                  onChange={(e) => setHero({ ...hero, launch_date: e.target.value })}
                  className="w-full px-4 py-3 rounded-lg border border-border bg-card text-foreground font-sans text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
            )}
            <button
              onClick={saveHero}
              disabled={isSaving}
              className="px-6 py-2.5 rounded-lg bg-primary text-primary-foreground font-sans text-sm font-medium hover:bg-olive-light transition-all disabled:opacity-50"
            >
              {isSaving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        )}

        {/* Subscribers Tab */}
        {activeTab === "subscribers" && (
          <div>
            <div className="flex items-center justify-between mb-6">
              <p className="text-sm text-muted-foreground font-sans">
                {subscribers.length} subscriber{subscribers.length !== 1 ? "s" : ""}
              </p>
              <button
                onClick={exportCSV}
                className="px-4 py-2 rounded-lg border border-border text-sm font-sans text-foreground hover:bg-muted transition-colors"
              >
                Export CSV
              </button>
            </div>
            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="text-left px-4 py-3 text-xs font-sans font-medium text-muted-foreground uppercase tracking-wider">Email</th>
                    <th className="text-left px-4 py-3 text-xs font-sans font-medium text-muted-foreground uppercase tracking-wider">Date</th>
                    <th className="px-4 py-3 w-10" />
                  </tr>
                </thead>
                <tbody>
                  {subscribers.map((sub) => (
                    <tr key={sub.id} className="border-t border-border hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 text-sm font-sans text-foreground">{sub.email}</td>
                      <td className="px-4 py-3 text-sm font-sans text-muted-foreground">
                        {new Date(sub.subscribed_at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => deleteSubscriber(sub.id)}
                          className="text-destructive hover:text-destructive/80 transition-colors text-xs font-sans"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                  {subscribers.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-4 py-8 text-center text-sm text-muted-foreground font-sans">
                        No subscribers yet
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminDashboard;
