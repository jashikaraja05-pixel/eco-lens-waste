import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ResultCard } from "@/routes/index";
import { normalizeBrowserReport } from "@/lib/browser-scan-schema";
import { normalizePrediction, GEMINI_SOURCE } from "@/lib/scan-schema";

afterEach(cleanup);
describe("Saved browser result display", () => {
  it("shows the actual saved category, bin, confidence and browser engine", () => {
    const result = normalizeBrowserReport({ item: "battery", confidence: 90, image: "data:image/png;base64,iVBORw0KGgo=", requestId: "11111111-1111-4111-8111-111111111111" });
    render(<ResultCard r={result} />);
    expect(screen.getByRole("heading", { name: "battery" })).toBeInTheDocument();
    expect(screen.getByText("Red Bin (Hazardous Waste Depot)")).toBeInTheDocument();
    expect(screen.getByText("Engine: MobileNetV3-Small (ONNX Browser)")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Prediction confidence" })).toHaveAttribute("aria-valuenow", "90");
    expect(screen.getByText("Saved to history")).toBeInTheDocument();
    expect(screen.getByText(/Model execution not independently verified/)).toBeInTheDocument();
  });
  it("shows a server-classified electrical switch with its real engine and E-Waste guidance", () => {
    const result = normalizePrediction({ item: "electrical switch", category: "ewaste", confidence: 92, reasoning: "Switch housing.", steps: ["Drop it at an authorised e-waste collection point."] }, GEMINI_SOURCE);
    render(<ResultCard r={result} />);
    expect(screen.getByRole("heading", { name: "electrical switch" })).toBeInTheDocument();
    expect(screen.getByText("Red Bin (Special E-Waste Bin)")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Gemini-reported confidence" })).toHaveAttribute("aria-valuenow", "92");
    expect(screen.getByText("Engine: Google Gemini (Render)")).toBeInTheDocument();
    expect(screen.getByText("Drop it at an authorised e-waste collection point.")).toBeInTheDocument();
  });
});