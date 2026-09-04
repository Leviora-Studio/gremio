import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDict, PDFDocument, PDFName, PDFString, PDFWidgetAnnotation, degrees } from "pdf-lib";
import { applyPdfEdits, readPdfFields } from "../lib/pdf-edit";
import { locatePdfWidgets } from "../lib/pdf-widget-compat";

/** Synthetic legacy structure, without any applicant data or signatures. */
async function fixture(legacy: boolean) {
  const doc = await PDFDocument.create();
  const pages = [doc.addPage([400, 600]), doc.addPage([400, 600])];
  pages[1].setRotation(degrees(90));
  const form = doc.getForm();
  const text = form.createTextField("applicant.name");
  text.setText("Original"); text.addToPage(pages[0], { x: 30, y: 400, width: 180, height: 25 });
  const repeated = form.createTextField("reference");
  repeated.setText("ABC");
  for (const page of pages) repeated.addToPage(page, { x: 30, y: 30, width: 180, height: 25 });
  const check = form.createCheckBox("receipt"); check.addToPage(pages[0], { x: 30, y: 300, width: 15, height: 15 }); check.check();
  const dropdown = form.createDropdown("account"); dropdown.addOptions(["A", "B"]); dropdown.select("A"); dropdown.addToPage(pages[0], { x: 80, y: 300, width: 80, height: 25 });
  const radio = form.createRadioGroup("campus");
  radio.addOptionToPage("A", pages[0], { x: 30, y: 250, width: 15, height: 15 });
  radio.addOptionToPage("B", pages[1], { x: 30, y: 250, width: 15, height: 15 }); radio.select("B");
  const merged = form.createTextField("merged");
  merged.setText("Merged original"); merged.addToPage(pages[0], { x: 30, y: 180, width: 100, height: 20 });
  const widget = merged.acroField.getWidgets()[0];
  for (const [key, value] of widget.dict.entries()) if (key !== PDFName.of("Parent")) merged.acroField.dict.set(key, value);
  merged.acroField.dict.delete(PDFName.of("Kids"));
  const annots = pages[0].node.Annots()!;
  annots.set(annots.size() - 1, merged.ref);
  form.updateFieldAppearances();
  if (legacy) for (const page of pages) {
    const annots = page.node.Annots()!;
    for (let i = 0; i < annots.size(); i++) {
      const widget = annots.lookup(i, PDFDict);
      const duplicate = widget.clone(doc.context);
      // Old producers omit P on both representations; Annots determine the page.
      widget.delete(PDFName.of("P")); duplicate.delete(PDFName.of("P"));
      annots.set(i, doc.context.register(duplicate));
    }
  }
  return doc;
}

test("native and detached legacy widgets expose identical positions, values and radio options", async () => {
  const modern = Buffer.from(await (await fixture(false)).save());
  const legacy = Buffer.from(await (await fixture(true)).save());
  const original = Buffer.from(legacy);
  assert.deepEqual(await readPdfFields(legacy), await readPdfFields(modern));
  assert.deepEqual(legacy, original, "reading never rewrites original bytes");
  const fields = await readPdfFields(legacy);
  assert.equal(fields.length, 6);
  assert.equal(fields.find(f => f.name === "reference")?.widgets?.length, 2);
  assert.equal(fields.find(f => f.name === "campus")?.optionWidgets?.length, 2);
  assert.ok(fields.every(f => f.widgets?.length || f.optionWidgets?.length));
});

test("legacy explicit edits update canonical values AND page appearances, preserving form interactivity", async () => {
  const original = Buffer.from(await (await fixture(true)).save());
  const output = await applyPdfEdits(original, { fields: [
    { name: "applicant.name", value: "Changed" }, { name: "reference", value: "XYZ" },
    { name: "receipt", value: false }, { name: "account", value: "B" }, { name: "campus", value: "A" },
    { name: "merged", value: "Merged changed" },
  ] });
  assert.deepEqual(output.failed, []);
  const doc = await PDFDocument.load(output.pdf);
  const fields = doc.getForm().getFields();
  const locations = locatePdfWidgets(doc, fields);
  for (const field of fields) {
    const located = locations.get(field)!;
    assert.ok(located.length);
    for (const { widget, source } of located) {
      assert.equal(widget.dict.lookup(PDFName.of("AP"))?.toString(), source.dict.lookup(PDFName.of("AP"))?.toString(), "page renders updated appearance");
      assert.equal(widget.dict.get(PDFName.of("AS"))?.toString(), source.dict.get(PDFName.of("AS"))?.toString());
    }
  }
  assert.equal(doc.getForm().getTextField("applicant.name").getText(), "Changed");
  assert.equal(doc.getForm().getCheckBox("receipt").isChecked(), false);
  assert.equal(doc.getForm().getRadioGroup("campus").getSelected(), "A");
  assert.equal((await readPdfFields(original)).find(f=>f.name==="applicant.name")?.value,"Original");
  assert.equal((await readPdfFields(output.pdf)).find(f=>f.name==="reference")?.widgets?.length,2);
});

test("legacy radio groups missing their Radio flag retain exclusive selection and explicit edits", async () => {
  const doc = await fixture(true);
  const radio = doc.getForm().getRadioGroup("campus");
  radio.acroField.setFlags(radio.acroField.getFlags() & ~(1 << 15));
  const bytes = Buffer.from(await doc.save({ updateFieldAppearances: false }));
  const fields = await readPdfFields(bytes);
  const group = fields.find(f=>f.name==="campus")!;
  assert.equal(group.type,"radio"); assert.equal(group.optionWidgets?.length,2);
  assert.equal(group.value, group.optionWidgets![1].value);
  assert.equal(fields.find(f=>f.name==="receipt")?.type,"checkbox");
  const result = await applyPdfEdits(bytes,{ fields:[{name:"campus",value:group.optionWidgets![0].value}] });
  assert.deepEqual(result.failed,[]);
  const reread = (await readPdfFields(result.pdf)).find(f=>f.name==="campus")!;
  assert.equal(reread.type,"radio");assert.equal(reread.value,group.optionWidgets![0].value);
  const stored = await PDFDocument.load(result.pdf);
  const storedField = stored.getForm().getRadioGroup("campus");
  const widgets = locatePdfWidgets(stored,[storedField]).get(storedField)!;
  assert.equal(widgets.filter(w=>w.widget.getAppearanceState()?.toString()!=="/Off").length,1);
});

test("different field names/types/values and ambiguous placements never get guessed", async () => {
  for (const mismatch of ["name", "type", "value", "rectangle"]) {
    const doc = await fixture(true);
    const widget = doc.getPages()[0].node.Annots()!.lookup(0, PDFDict);
    if (mismatch === "name") widget.set(PDFName.of("T"), PDFString.of("Other"));
    if (mismatch === "type") widget.set(PDFName.of("FT"), PDFName.of("Btn"));
    if (mismatch === "value") widget.set(PDFName.of("V"), PDFString.of("Stale"));
    if (mismatch === "rectangle") PDFWidgetAnnotation.fromDict(widget).setRectangle({x:100,y:100,width:10,height:10});
    const field = doc.getForm().getTextField("applicant.name");
    assert.equal(locatePdfWidgets(doc, [field]).get(field)?.length,0,mismatch);
  }
  const doc = await fixture(true);
  const repeated = doc.getForm().getTextField("reference");
  for (const w of repeated.acroField.getWidgets()) w.dict.delete(PDFName.of("AP"));
  assert.equal(locatePdfWidgets(doc,[repeated]).get(repeated)?.length,0,"same rectangle on multiple pages without distinguishing appearance remains unresolved");
});
