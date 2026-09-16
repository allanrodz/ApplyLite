export function detectAts(url: string) {
  const value = url.toLowerCase();
  if (value.includes("greenhouse.io")) return "greenhouse";
  if (value.includes("lever.co")) return "lever";
  if (value.includes("ashbyhq.com")) return "ashby";
  if (value.includes("workable.com")) return "workable";
  if (value.includes("myworkdayjobs.com") || value.includes("workday.com")) return "workday";
  return "generic";
}
