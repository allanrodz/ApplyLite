import {ActivityCentre} from "./components/TaskProgress";
import { useEffect } from "react";
import { useLocation, viewFromPath, navigate, guideTo, type View } from "./lib/navigation";
import { GettingStarted } from "./components/GettingStarted";
import { PackageNotifications } from "./components/PackageNotifications";
import { UpdateBanner } from "./components/UpdateBanner";
import { DashboardPage } from "./pages/DashboardPage";
import { ProfilePage } from "./pages/ProfilePage";
import { AnswersPage } from "./pages/AnswersPage";
import { CvPage } from "./pages/CvPage";
import { DiscoverPage } from "./pages/DiscoverPage";
import { SkillGrowthPage } from "./pages/SkillGrowthPage";
import { ApplicationsPage } from "./pages/ApplicationsPage";
import { OutcomeLearningPage } from "./pages/OutcomeLearningPage";
import { DailyBriefPage } from "./pages/DailyBriefPage";
import { ReviewQueuePage } from "./pages/ReviewQueuePage";
import { CareerCoachPage } from "./pages/CareerCoachPage";
import { SystemPage } from "./pages/SystemPage";
import { GmailPage } from "./pages/GmailPage";

export function App() {
  const location = useLocation();
  const view = viewFromPath(window.location.pathname);
  const setView = (value: View) => {
    if (value === "discover") {
      navigate(sessionStorage.getItem("applylite:last-discovery-url") || "/discover");
      return;
    }
    navigate(value === "dashboard" ? "/" : `/${value}`);
  };
  useEffect(() => { if (window.location.hash) guideTo(window.location.hash.slice(1)); }, [location]);

  return (
    <>
      <UpdateBanner />
      <div className="shell">
      <PackageNotifications />
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">A</div>
          <div>
            <strong>ApplyLite</strong>
            <span>local job copilot - v0.16.8</span>
          </div>
        </div>

        <nav>
          <button className={view === "dashboard" ? "active" : ""} onClick={() => setView("dashboard")}>Dashboard</button>
          <button className={view === "daily" ? "active" : ""} onClick={() => setView("daily")}>Daily Brief</button>
          <button className={view === "review" ? "active" : ""} onClick={() => setView("review")}>Review Queue</button>
          <button className={view === "applications" ? "active" : ""} onClick={() => setView("applications")}>Applications</button>
          <button className={view === "gmail" ? "active" : ""} onClick={() => setView("gmail")}>Gmail Intelligence</button>
          <button className={view === "coach" ? "active" : ""} onClick={() => setView("coach")}>Interview & Follow-up</button>
          <button className={view === "outcomes" ? "active" : ""} onClick={() => setView("outcomes")}>Outcome Learning</button>
          <button className={view === "discover" ? "active" : ""} onClick={() => setView("discover")}>Discover</button>
          <button className={view === "growth" ? "active" : ""} onClick={() => setView("growth")}>Skill Growth</button>
          <button className={view === "cv" ? "active" : ""} onClick={() => setView("cv")}>CV intelligence</button>
          <button className={view === "profile" ? "active" : ""} onClick={() => setView("profile")}>Profile</button>
          <button className={view === "answers" ? "active" : ""} onClick={() => setView("answers")}>Answer library</button>
          <button className={view === "system" ? "active" : ""} onClick={() => setView("system")}>System & Recovery</button>
        </nav>

        <ActivityCentre />
        <div className="safety-note">
          <strong>Review mode</strong>
          <span>Review every extracted fact and employer form. You control final submission.</span>
        </div>
      </aside>

      <main className="content" id="main-content">
        {["dashboard","cv","profile","discover"].includes(view || "") && <GettingStarted />}
        {!view && <section className="panel"><h1>Page not found</h1><button onClick={() => navigate("/")}>Go to Dashboard</button></section>}
        {view === "dashboard" && <DashboardPage />}
        {view === "daily" && <DailyBriefPage />}
        {view === "review" && <ReviewQueuePage />}
        {view === "applications" && <ApplicationsPage />}
        {view === "gmail" && <GmailPage />}
        {view === "coach" && <CareerCoachPage />}
        {view === "outcomes" && <OutcomeLearningPage />}
        {view === "discover" && <DiscoverPage />}
        {view === "growth" && <SkillGrowthPage />}
        {view === "cv" && <CvPage />}
        {view === "profile" && <ProfilePage />}
        {view === "answers" && <AnswersPage />}
        {view === "system" && <SystemPage />}
      </main>
    </div>
    </>
  );
}
