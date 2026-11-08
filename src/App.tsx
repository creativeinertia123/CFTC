import { Routes, Route } from "react-router";
import AppLayout from "@/components/AppLayout";
import Home from "@/pages/Home";
import MarketDetail from "@/pages/MarketDetail";
import Matrix from "@/pages/Matrix";
import Updates from "@/pages/Updates";
import Note from "@/pages/Note";
import NotFound from "@/pages/NotFound";

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<Home />} />
        <Route path="/matrix" element={<Matrix />} />
        <Route path="/updates" element={<Updates />} />
        <Route path="/note" element={<Note />} />
        <Route path="/market/:code" element={<MarketDetail />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
