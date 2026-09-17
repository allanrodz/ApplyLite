import { navigate, guideTo } from "../lib/navigation";
import { useEffect, useState } from "react";
import { ProfileSchema, type AutofillMapping, type Profile } from "@apply-lite/shared";
import { API_BASE, api } from "../lib/api";

type ExperienceSummary = {
  totalYears: number;
  technicalYears: number;
  parseableEmploymentCount: number;
  scoringDefaultYears: number;
  scoringSource: string;
  warnings?: string[];
};

export function ProfilePage() {
  const [suggestions,setSuggestions] = useState<{cvId:number|null;suggestions:{title:string;confidence:number;evidence:string[]}[]}>({cvId:null,suggestions:[]});
  const [selectedRoles,setSelectedRoles] = useState<string[]>([]);
  const [profile, setProfile] = useState<Profile>(ProfileSchema.parse({}));
  const [experience, setExperience] = useState<ExperienceSummary | null>(null);
  const [message, setMessage] = useState("");
  const [mappings, setMappings] = useState<AutofillMapping[]>([]);
  const [saving, setSaving] = useState(false);
  const [listDraft, setListDraft] = useState({ targetTitles: "", skills: "", preferredLocations: "" });

  useEffect(() => {
    Promise.all([api<Profile>("/profile"), api<ExperienceSummary>("/experience/summary"), api<AutofillMapping[]>("/automation/mappings")])
      .then(([savedProfile, summary, learnedMappings]) => { setProfile(savedProfile); setListDraft({ targetTitles: savedProfile.targetTitles.join(", "), skills: savedProfile.skills.join(", "), preferredLocations: savedProfile.preferredLocations.join(", ") }); setExperience(summary); setMappings(learnedMappings); })
      .catch((e) => setMessage(e.message));
  }, []);

  useEffect(()=>{void api<typeof suggestions>("/profile/role-suggestions").then(setSuggestions).catch(()=>{});},[]);

  const parseCsv = (value: string) => value.split(/[,;\n]/).map((v) => v.trim()).filter(Boolean);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const saved = await api<Profile>("/profile", { method: "PUT", body: JSON.stringify({ ...profile, ...Object.fromEntries(Object.entries(listDraft).map(([key, value]) => [key, parseCsv(value)])) }) });
      setProfile(saved);
      setMessage("Profile saved locally."); guideTo("profile-discover");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not save profile");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <header className="page-header"><div><span className="eyebrow">SOURCE OF TRUTH</span><h1>Candidate profile</h1><p>These facts drive scoring and browser autofill. M4.1 also learns how employer forms label these fields.</p></div></header>
      {message && <div className="notice">{message}</div>}
      <section className="profile-readiness">
        <div><span>Local API</span><strong>{API_BASE}</strong></div>
        <div><span>Autofill identity</span><strong>{[profile.firstName, profile.lastName, profile.email, profile.city, profile.country].filter((value) => value.trim()).length}/5 core fields</strong></div>
        <div><span>Learned form mappings</span><strong>{mappings.length}</strong></div>
      </section>
      {experience && (
        <section className="panel experience-profile">
          <div><span className="eyebrow">CV-DERIVED</span><strong>{experience.totalYears} years across dated employment</strong></div>
          {experience.technicalYears > 0 && <div><span>Technology-related roles</span><strong>{experience.technicalYears} years</strong></div>}
          <div><span>Employment ranges parsed</span><strong>{experience.parseableEmploymentCount}</strong></div>
          {experience.warnings?.map((warning,i)=><p className="muted" key={i}>{warning}</p>)}
          <p>Job-specific scoring now derives relevant experience from your employment dates. The manual Years experience field remains a fallback only when CV evidence cannot be calculated.</p>
        </section>
      )}
      {suggestions.suggestions.length > 0 && <section className="panel" id="role-suggestions"><h2>Suggested roles from your reviewed CV</h2><p>Suggestions are preferences, not claims of qualification. Choose only the roles you want.</p>{suggestions.suggestions.map(s=><label className="choice-row" key={s.title}><input type="checkbox" checked={selectedRoles.includes(s.title)} onChange={e=>setSelectedRoles(old=>e.target.checked?[...old,s.title]:old.filter(t=>t!==s.title))}/><span><strong>{s.title}</strong><small>{s.confidence>=0.8?"Direct CV title":"Related skills suggestion"}: {s.evidence.join("; ")}</small></span></label>)}<button disabled={!selectedRoles.length || saving} onClick={()=>{setListDraft(old=>({...old,targetTitles:[...new Set([...parseCsv(old.targetTitles),...selectedRoles])].join(", ")}));setSelectedRoles([]);setMessage("Selected suggestions added to the form. Save profile to confirm your choices.");guideTo("target-roles");}}>Use selected suggestions</button></section>}
      <form className="panel" onSubmit={save}>
        <div className="form-grid">
          <label>First name<input value={profile.firstName} onChange={(e) => setProfile({ ...profile, firstName: e.target.value })} /></label>
          <label>Last name<input value={profile.lastName} onChange={(e) => setProfile({ ...profile, lastName: e.target.value })} /></label>
          <label>Email<input type="email" autoComplete="email" value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} /></label>
          <label>Phone<input type="tel" autoComplete="tel" value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} /></label>
          <label>City<input value={profile.city} onChange={(e) => setProfile({ ...profile, city: e.target.value })} /></label>
          <label>Country<input value={profile.country} onChange={(e) => setProfile({ ...profile, country: e.target.value })} /></label>
          <label>Current title<input value={profile.currentTitle} onChange={(e) => setProfile({ ...profile, currentTitle: e.target.value })} /></label>
          <label>Years experience<input type="number" min="0" value={profile.yearsExperience} onChange={(e) => setProfile({ ...profile, yearsExperience: Number(e.target.value) })} /></label>
          <label className="full">Target titles<input id="target-roles" value={listDraft.targetTitles} onChange={(e) => setListDraft({ ...listDraft, targetTitles: e.target.value })} placeholder="Your desired job titles, separated by commas" /></label>
          <label className="full">Skills<textarea rows={4} value={listDraft.skills} onChange={(e) => setListDraft({ ...listDraft, skills: e.target.value })} placeholder="Skills from your CV, separated by commas" /></label>
          <label className="full">Preferred locations<input id="preferred-locations" value={listDraft.preferredLocations} onChange={(e) => setListDraft({ ...listDraft, preferredLocations: e.target.value })} placeholder="Dublin, Ireland, Remote" /></label>
          <label>Remote preference<select value={profile.remotePreference} onChange={(e) => setProfile({ ...profile, remotePreference: e.target.value as Profile["remotePreference"] })}><option value="any">Any</option><option value="remote">Remote</option><option value="hybrid">Hybrid</option><option value="onsite">On-site</option></select></label>
          <label>Minimum salary<input type="number" min="0" value={profile.minimumSalary ?? ""} onChange={(e) => setProfile({ ...profile, minimumSalary: e.target.value ? Number(e.target.value) : null })} /></label>
          <label className="full">Work authorisation<input value={profile.workAuthorization} onChange={(e) => setProfile({ ...profile, workAuthorization: e.target.value })} /></label>
          <label>LinkedIn<input value={profile.linkedinUrl} onChange={(e) => setProfile({ ...profile, linkedinUrl: e.target.value })} /></label>
          <label>GitHub<input value={profile.githubUrl} onChange={(e) => setProfile({ ...profile, githubUrl: e.target.value })} /></label>
          <label>Google Scholar<input value={profile.googleScholarUrl} onChange={(e) => setProfile({ ...profile, googleScholarUrl: e.target.value })} placeholder="Optional" /></label>
          <label>X / Twitter<input value={profile.xUrl} onChange={(e) => setProfile({ ...profile, xUrl: e.target.value })} placeholder="Optional" /></label>
          <label className="full">Portfolio / website<input value={profile.portfolioUrl} onChange={(e) => setProfile({ ...profile, portfolioUrl: e.target.value })} /></label>
          <label className="full">Professional summary<textarea rows={6} value={profile.summary} onChange={(e) => setProfile({ ...profile, summary: e.target.value })} /></label>
        </div>
        <div className="actions"><button className="primary" disabled={saving}>{saving ? "Saving..." : "Save profile"}</button></div>
      </form>
      <section className="panel" id="profile-discover"><h2>Continue to opportunities</h2><p>Target roles guide your search. Other preferences can be adjusted later.</p><button disabled={!listDraft.targetTitles.trim()} onClick={() => navigate("/discover")}>Discover jobs</button></section>
    </>
  );
}
