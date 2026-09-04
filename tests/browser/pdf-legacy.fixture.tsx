import { createRoot } from "react-dom/client";
import PdfEditor from "../../components/pdf/PdfEditor";

createRoot(document.getElementById("root")!).render(
  <div className="flex h-screen flex-col">
    <PdfEditor src="/original.pdf" fieldsUrl="/fields" filename="Legacy form — local read-only test source" attachmentId={1} editable hasCert={false} onClose={() => {}} saveAction={async () => ({ ok: false, error: "Sample PDF is never saved by this test." })} />
  </div>,
);
