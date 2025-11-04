import React, { useEffect } from "react";
import { useParams } from "react-router-dom";
import KanbanCardPreview from "./KanbanCardPreview";

export default function KanbanPrint() {
  const { id } = useParams();

  // Auto-open the native print dialog after mount
  useEffect(() => {
    const t = setTimeout(() => window.print(), 350);
    return () => clearTimeout(t);
  }, []);

  // Render your existing preview component in "printOnly" mode
  return <KanbanCardPreview printOnly idOverride={id} />;
}
