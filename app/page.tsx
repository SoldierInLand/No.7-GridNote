import type { Metadata } from "next";
import { GridnoteEditor } from "./GridnoteEditor";

export const metadata: Metadata = {
  title: "Gridnote — portable visual notebooks",
  description:
    "Arrange rich notes on a structural grid and export them as portable HTML, CSS, and JavaScript.",
};

export default function Home() {
  return <GridnoteEditor />;
}
