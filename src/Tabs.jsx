import React from "react";
import axios from "axios";

export default function Tabs({ tabs, activeTab, onSelect }) {
  const handleLogout = async () => {
    try {
      await axios.get(
        `${process.env.REACT_APP_API_ROOT}/logout`,
        { withCredentials: true }
      );
      // Redirect to frontend login or home page
      window.location.href = window.location.origin;
    } catch (err) {
      console.error("Logout failed:", err);
      alert("Logout failed. Please try again.");
    }
  };

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      borderBottom: "1px solid #ccc",
      backgroundColor: "#fafafa"
    }}>
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
      {/* Spacer to push logout button to the right */}
      <div style={{ marginLeft: "auto", padding: "0 1.5rem" }}>
        <button
          onClick={handleLogout}
          style={{
            padding: "0.5rem 1rem",
            backgroundColor: "#f44336",
            color: "#fff",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer"
          }}
        >
          Logout
        </button>
      </div>
    </div>
  );
}
