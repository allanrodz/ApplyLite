import { useState } from "react";
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

type View = "dashboard" | "daily" | "review" | "applications" | "gmail" | "coach" | "outcomes" | "discover" | "growth" | "cv" | "profile" | "answers" | "system";

export function App() {
  const [view, setView] = useState<View>("dashboard");

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">A</div>
          <div>
            <strong>ApplyLite</strong>
            <span>local job copilot</span>
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

        <div className="safety-note">
          <strong>Review mode</strong>
          <span>ApplyLite never invents candidate facts and never clicks the final submit button without your review.</span>
        </div>
      </aside>

      <main className="content">
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
  );
}
