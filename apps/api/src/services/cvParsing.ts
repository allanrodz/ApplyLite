import { CandidateFactsSchema, type CandidateFacts } from "@apply-lite/shared";
import { cvSectionAliases, sectionBoundaryAfterSkills } from "./reliabilityPolicy.js";
import { containsTerm, canonicalSkill } from "./matching.js";
export type CvSection = {kind:string;text:string;startLine:number};
const norm = (s:string) => s.normalize("NFD").replace(/\p{M}/gu,"").toLowerCase().replace(/[:\s]+$/g,"").trim();
const headings: Record<string,string> = {...cvSectionAliases,
 skills:"skills","technical skills":"skills","core skills":"skills","key skills":"skills","core competencies":"skills",habilidades:"skills",competencias:"skills","competencias tecnicas":"skills",
 summary:"summary",profile:"summary","professional summary":"summary","personal profile":"summary",perfil:"summary",resumo:"summary",
 experience:"employment",employment:"employment","work experience":"employment","professional experience":"employment","employment history":"employment","experiencia profissional":"employment",
 education:"education","academic qualifications":"education","formacao academica":"education",educacao:"education",languages:"languages",idiomas:"languages",
 certifications:"certifications",certificates:"certifications",certificacoes:"certifications",projects:"projects","selected projects":"projects","personal projects":"projects",interests:"other",references:"other",contact:"contacts","contact details":"contacts"
};
export function segmentCv(raw:string): CvSection[] {
 const result:CvSection[]=[];let section:CvSection={kind:"contacts",text:"",startLine:1};
 raw.replace(/\r\n/g,"\n").split("\n").forEach((value,i)=>{
   const line=value.trim(), inline=line.match(/^([^:]{2,60}):\s*(.*)$/), key=norm(inline?.[1]||line);
   const kind=headings[key];
   if(kind){if(section.text.trim())result.push(section);section={kind,text:inline?.[2]?inline[2]+"\n":"",startLine:i+1};}
   else if(section.kind==="skills" && sectionBoundaryAfterSkills(line)){if(section.text.trim())result.push(section);section={kind:"other",text:line+"\n",startLine:i+1};}
   else section.text+=value+"\n";
 });
 if(section.text.trim())result.push(section);return result;
}
const months:Record<string,string>={jan:"01",january:"01",feb:"02",february:"02",mar:"03",march:"03",apr:"04",april:"04",may:"05",jun:"06",june:"06",jul:"07",july:"07",aug:"08",august:"08",sep:"09",sept:"09",september:"09",oct:"10",october:"10",nov:"11",november:"11",dec:"12",december:"12"};
export function normalizeCvDate(raw:string):{raw:string;normalized:string|null;precision:"month"|"year"|"present"|"unknown"} {
 const value=raw.trim();
 if(/^(present|current|now|ongoing|presente|atual)$/i.test(value))return{raw,normalized:"present",precision:"present"};
 if(/^(19|20)\d{2}$/.test(value))return{raw,normalized:value,precision:"year"};
 let m=value.match(/^(\d{4})[-/](\d{1,2})$/); if(m && +m[2]>=1 && +m[2]<=12)return{raw,normalized:`${m[1]}-${m[2].padStart(2,"0")}`,precision:"month"};
 m=value.match(/^(\d{1,2})[-/](\d{4})$/);if(m && +m[1]>=1 && +m[1]<=12)return{raw,normalized:`${m[2]}-${m[1].padStart(2,"0")}`,precision:"month"};
 m=value.match(/^([a-z]+)\.?\s+(\d{4})$/i);if(m && months[m[1].toLowerCase()])return{raw,normalized:`${m[2]}-${months[m[1].toLowerCase()]}`,precision:"month"};
 return{raw,normalized:null,precision:"unknown"};
}
const dateToken=String.raw`(?:[A-Za-z]{3,9}\.?\s+(?:19|20)\d{2}|(?:19|20)\d{2}[-/]\d{1,2}|\d{1,2}[-/](?:19|20)\d{2}|(?:19|20)\d{2})`;
const range=new RegExp(`(${dateToken})\\s*(?:-|\\u2013|\\u2014|to|until|a)\\s*(${dateToken}|Present|Current|Ongoing|Presente|Atual)`,"i");
export function dateRange(text:string){const m=text.match(range);return m?{startDate:m[1],endDate:m[2],raw:m[0]}:null;}
const bullet=(s:string)=>/^\s*[\u2022\u25cf*\-]\s*/.test(s);
const strip=(s:string)=>s.replace(/^\s*[\u2022\u25cf*\-]\s*/,"").trim();
const titleLike=(s:string)=>s.length<110 && /\b(developer|engineer|manager|analyst|assistant|officer|consultant|nurse|teacher|receptionist|accountant|technician|designer|coordinator|specialist|intern|trainee|barista|chef|administrator|bookkeeper|executive|tutor|carer|driver|operative|waiter|waitress|cashier|representative|director)\b/i.test(s);
const institution=(s:string)=>/\b(university|college|institute|school|academy|universidade|faculdade)\b/i.test(s);
const qualification=(s:string)=>/\b(bachelor|master|diploma|certificate|certification|phd|ph\.d|msc|m\.sc|bsc|b\.sc|beng|llb|mba|degree|licenciatura|mestrado)\b/i.test(s);
function employmentRecords(text:string):CandidateFacts["employment"] {
 const lines=text.split("\n").map(s=>s.trim()).filter(Boolean),out:CandidateFacts["employment"]=[];
 let current:CandidateFacts["employment"][number]|null=null;let header:string[]=[];
 const begin=(title:string,employer:string,dates:{startDate:string;endDate:string}|null,location="")=>{if(current)out.push(current);return {title,employer,startDate:dates?.startDate||"",endDate:dates?.endDate||"",location,bullets:[] as string[]};};
 for(let i=0;i<lines.length;i++){
  const line=lines[i],parts=line.split(/\s*\|\s*/),dates=dateRange(line);
  if(parts.length>=3 && dates){current=begin(parts[0],parts[1],dates,parts[3]||"");header=[];continue;}
  if(dates){
    const prefix=line.slice(0,line.indexOf(dates.raw)).replace(/[|,\s-]+$/g,"").trim();
    const candidates=[...header,...(prefix?[prefix]:[])].slice(-2);
    const role=candidates.find(titleLike)||"",employer=candidates.find(s=>s!==role)||"";
    if(role||employer)current=begin(role,employer,dates);
    else if(current && !current.startDate){current.startDate=dates.startDate;current.endDate=dates.endDate;}
    header=[];continue;
  }
  const next=lines[i+1]||"",after=lines[i+2]||"";
  if(!bullet(line) && ((titleLike(line) && next && !bullet(next) && !dateRange(next)) || (!titleLike(line) && titleLike(next)))){
    if(dateRange(after)){header=[line,next];i++;continue;}
    if(!dateRange(next) && line.length<120 && next.length<120){current=begin(titleLike(line)?line:next,titleLike(line)?next:line,null);header=[];i++;continue;}
  }
  if(!current){if(!bullet(line) && line.length<150)header.push(line);continue;}
  if(/^location\s*:/i.test(line)) current.location=line.replace(/^location\s*:\s*/i,"");
  else current.bullets.push(strip(line));
 }
 if(current)out.push(current);
 return out;
}
function educationRecords(text:string):CandidateFacts["education"] {
 const lines=text.split("\n").map(s=>s.trim()).filter(Boolean),out:CandidateFacts["education"]=[];let current:CandidateFacts["education"][number]|null=null;
 for(let i=0;i<lines.length;i++){
  const line=lines[i],next=lines[i+1]||"",dates=dateRange(line);
  if(dates && current){current.startDate=dates.startDate;current.endDate=dates.endDate;continue;}
  const parts=line.split(/\s*\|\s*|,\s*/);const q=parts.find(qualification),u=parts.find(institution);
  if(q||institution(line)){
    if(current && (current.qualification || current.institution))out.push(current);
    current={qualification:q||"",institution:u||"",field:"",startDate:dates?.startDate||"",endDate:dates?.endDate||"",details:[]};
    if(!current.institution && institution(next)){current.institution=next;i++;}
    else if(!current.qualification && qualification(next)){current.qualification=next;i++;}
  }else if(current)current.details.push(strip(line));
 }
 if(current && (current.qualification||current.institution))out.push(current);return out;
}
function projectRecords(text:string):CandidateFacts["projects"] {
 const blocks=text.split(/\n\s*\n/).map(s=>s.trim()).filter(Boolean);
 return blocks.map(block=>{const lines=block.split("\n").filter(Boolean);const name=strip(lines.shift()||"");const technologies=lines.filter(s=>/^(technologies|tech stack|stack)\s*:/i.test(s)).flatMap(s=>s.replace(/^[^:]+:\s*/,"").split(/[,;|]/).map(s=>s.trim()).filter(Boolean));const details=lines.filter(s=>!/^(technologies|tech stack|stack)\s*:/i.test(s));return{name,technologies,description:details.filter(s=>!bullet(s)).join(" "),bullets:details.filter(bullet).map(strip)};}).filter(p=>p.name);
}
export function enrichLocalDraft(base:CandidateFacts,raw:string):CandidateFacts {
 const sections=segmentCv(raw),facts=CandidateFactsSchema.parse(base);
 const contacts=sections.filter(s=>s.kind==="contacts").map(s=>s.text).join("\n");
 const urls=contacts.match(/(?:https?:\/\/|www\.)[^\s<>]+/g)||[];
 for(const url of urls){const value=url.replace(/[).,;]+$/,"");if(/(?:www\.)?linkedin\.com\//i.test(value))facts.linkedinUrl=value;else if(/(?:www\.)?github\.com\//i.test(value))facts.githubUrl=value;else if(!facts.portfolioUrl)facts.portfolioUrl=value;}
 const labeledLocation=contacts.match(/^(?:location|based in|address)\s*:\s*([^\n]+)/im);
 if(labeledLocation){const p=labeledLocation[1].split(",").map(s=>s.trim());if(p.length===2){facts.city=p[0];facts.country=p[1];}}
 const headerLines=contacts.split("\n").map(s=>s.trim()).filter(Boolean);facts.headline=headerLines.slice(0,6).find(s=>titleLike(s)&&!s.includes("@")&&!/\d{4}/.test(s))||facts.headline;
 facts.employment=sections.filter(s=>s.kind==="employment").flatMap(s=>employmentRecords(s.text));
 facts.education=sections.filter(s=>s.kind==="education").flatMap(s=>educationRecords(s.text));
 facts.projects=sections.filter(s=>s.kind==="projects").flatMap(s=>projectRecords(s.text));
 return facts;
}
export function cvDiagnostics(facts:CandidateFacts){
 const missing:{path:string;label:string;message:string;required:boolean}[]=[];
 for(const [key,label] of [["fullName","Name"],["email","Email"]] as const)if(!facts[key])missing.push({path:key,label,message:`${label} was not identified. Add it before preparing applications.`,required:false});
 if(!facts.skills.length)missing.push({path:"skills",label:"Skills",message:"Add explicit CV skills to improve matching.",required:false});
 facts.employment.forEach((e,i)=>{for(const [key,label] of [["title","Job title"],["employer","Employer"],["startDate","Start date"],["endDate","End date"]] as const)if(!e[key] || (key.endsWith("Date") && !normalizeCvDate(e[key]).normalized))missing.push({path:`employment.${i}.${key}`,label:`Employment ${i+1}: ${label}`,message:key.endsWith("Date")?"Use month/year, year, or Present. Dates improve scoring but are optional.":"Review against the source text.",required:false});});
 return {missingFields:missing,dates:facts.employment.map(e=>({start:normalizeCvDate(e.startDate),end:normalizeCvDate(e.endDate)})),note:"All fields are reviewable. Unknown dates stay unknown; a year-only date does not establish exact months."};
}
export function suggestedRoles(facts:CandidateFacts) {
 const suggestions:{title:string;confidence:number;evidence:string[]}[]=[];
 const add=(title:string,confidence:number,evidence:string[])=>{if(title && !suggestions.some(s=>s.title.toLowerCase()===title.toLowerCase()) && suggestions.length<8)suggestions.push({title,confidence,evidence});};
 [...facts.employment].sort((a,b)=>Number(/present|current/i.test(b.endDate))-Number(/present|current/i.test(a.endDate))).slice(0,3).forEach(e=>add(e.title,0.9,[`Reviewed employment: ${e.title}${e.employer ? " at "+e.employer : ""}`]));
 const skills=[...facts.skills,...facts.projects.flatMap(p=>p.technologies)].map(canonicalSkill);
 const rules:[string,string[]][]=[["Frontend Developer",["react","javascript","typescript"]],["Software Developer",["python","javascript","typescript","c#","java"]],["Data Analyst",["sql","power bi","python"]],["Accounts Assistant",["bookkeeping","payroll","accounts payable"]],["Customer Service Representative",["customer service","customer support"]],["IT Support Technician",["technical support","active directory","helpdesk"]],["QA Tester",["selenium","software testing","test automation"]],["Marketing Assistant",["seo","social media","content marketing"]]];
 for(const [title,signals]of rules){const hit=signals.filter(s=>skills.includes(canonicalSkill(s)));if(hit.length>=Math.min(2,signals.length))add(title,0.65,[`Reviewed skills: ${hit.join(", ")}`]);}
 return suggestions;
}
