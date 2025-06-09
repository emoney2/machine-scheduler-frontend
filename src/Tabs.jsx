import React from "react";

export default function Tabs({ tabs, activeTab, onSelect }) {
  return (
    <div style={{
      display: "flex",
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
              color: "#333",                    // uniform dark text
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
    </div>
  );
}
