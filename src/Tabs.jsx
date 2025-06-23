import React from "react";
import axios from "axios";

export default function Tabs({ tabs, activeTab, onSelect }) {
  const handleLogout = async () => {
    try {
      await axios.get(
        `${process.env.REACT_APP_API_ROOT}/logout`,
        { withCredentials: true }
      );
    } catch (err) {
      console.error("Logout failed:", err);
    }
    // Redirect back to frontend
    window.location.href = "https://machineschedule.netlify.app/";
  };

  return (
    <div
      style={{
        display: "flex",
        borderBottom: "1px solid #ccc",
        backgroundColor: "#fafafa",
        alignItems: "center"
      }}
    >
      {tabs.map(tab => {
        const isActive = tab === activeTab;
        return (
          <div
            key={tab}
            onClick={() => onSelect(tab)}
            style={{
              padding: "0.75rem 1.5rem",
              cursor: "pointer",
              backgroundColor: isActive ? "#e0e0e0" : "transparent",
              color: "#333",
              fontWeight: isActive ? "600" : "400",
              border: "1px solid #ccc",
              borderBottom: isActive ? "none" : "1px solid #ccc",
              borderTopLeftRadius: "4px",
              borderTopRightRadius: "4px",
              marginBottom: isActive ? "-1px" : "0"
            }}
          >
            {tab}
          </div>
        );
      })}

      {/* Spacer to push logout button right */}
      <div style={{ flex: 1 }} />

      {/* Logout Button */}
      <button
        onClick={handleLogout}
        style={{
          padding: "0.75rem 1rem",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          fontWeight: "500",
          color: "#333",
          marginRight: "1rem"
        }}
      >
        Logout
      </button>
    </div>
  );
}
