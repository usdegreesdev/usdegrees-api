import React from "react";
import { theme } from "./theme";
import { NO_AID_BOX_TEXT } from "../utils/missingValue";

/** Small box shown in a no-federal-aid school's net price / typical debt cell. */
export default function NoAidBox() {
  return (
    <div
      style={{
        display: "inline-block",
        textAlign: "left",
        fontSize: "8.5px",
        fontWeight: 400,
        lineHeight: "1.35",
        color: theme.color.inkMuted,
        backgroundColor: theme.color.panelBg,
        border: `1px solid ${theme.color.hairline}`,
        borderRadius: "4px",
        padding: "4px 6px",
      }}
    >
      {NO_AID_BOX_TEXT}
    </div>
  );
}
