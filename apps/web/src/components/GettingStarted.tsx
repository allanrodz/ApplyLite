import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { navigate } from "../lib/navigation";
type State = {cvUploaded:boolean;cvReviewed:boolean;profileMerged:boolean;hasSkills:boolean;hasTargetTitles:boolean;hasPreferredLocations:boolean;readyForDiscovery:boolean;nextStep:string;nextHref:string;missingFields:{message:string;href:string;required:boolean}[]};
const labels: Record<string,string> = {upload:"Upload your CV",review:"Review CV facts",merge:"Use reviewed facts in Profile",target_titles:"Choose target roles",locations:"Review location preferences",discover:"Discover jobs"};
export function GettingStarted() {
  const [state,setState] = useState<State|null>(null);
  useEffect(() => { let alive=true; const load=()=>void api<State>("/onboarding/status").then(s=>{if(alive)setState(s);}).catch(()=>{});load();window.addEventListener("applylite:data",load);return()=>{alive=false;window.removeEventListener("applylite:data",load);}; },[]);
  if (!state) return null;
  return <section className="setup-guide" aria-label="Getting started"><div><span className="eyebrow">CV TO OPPORTUNITIES</span><h2>{state.nextStep === "discover" ? "Ready to discover" : "Your next step"}</h2><p>{labels[state.nextStep]}</p></div><ol>{[[state.cvUploaded,"Upload"],[state.cvReviewed,"Review"],[state.profileMerged,"Profile"],[state.hasTargetTitles,"Roles"],[state.hasPreferredLocations,"Locations"]].map(([done,label])=><li key={String(label)} data-complete={!!done}>{done ? "Done: " : "Next: "}{label}</li>)}</ol><button className="primary" onClick={()=>navigate(state.nextHref)}>{labels[state.nextStep]}</button><small>Missing dates and optional contact details do not prevent browsing jobs.</small></section>;
}
