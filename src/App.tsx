import { ConfigProvider } from "antd";
import React from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router";

const CdaNullEntries = React.lazy(() => import("./CDA-NULL-ENTRIES"));
const CmaSyncIssue = React.lazy(() => import("./CMA-SYNC-ISSUE"));
const CdaSyncIssue = React.lazy(() => import("./CDA-SYNC-ISSUE"));
export default function App() {
  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: "#353b48",
        },
      }}
    >
      <Router>
        <Routes>
          <Route path="/cda-null-entries" element={<CdaNullEntries />} />
          <Route path="/cma-sync-issue" element={<CmaSyncIssue />} />
          <Route path="/cda-sync-issue" element={<CdaSyncIssue />} />
          <Route path="/" element={<DefaultPage />} />
        </Routes>
      </Router>
    </ConfigProvider>
  );
}

function DefaultPage() {
  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh" }}>
      <p>404 - Page not found. Please enter the exact URL of the page you want to access.</p>
    </div>
  );
}
