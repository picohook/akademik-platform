import {createRequire} from 'node:module';
import path from 'node:path';
const require=createRequire(path.resolve('spike/app/package.json'));
const {PDFDocument,PDFName,PDFString,PDFOperator,StandardFonts}=require('pdf-lib');
export async function multiPageTagged(){
 const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica),ctx=doc.context;
 doc.setCreationDate(new Date('2026-10-25T00:00:00Z'));doc.setModificationDate(new Date('2026-10-25T00:00:00Z'));
 const root=ctx.obj({Type:'StructTreeRoot'}),rootRef=ctx.register(root),sections=[],parents=[];
 for(let p=0;p<2;p++){
  const page=doc.addPage([600,800]),section=ctx.obj({Type:'StructElem',S:'Sect',P:rootRef,Pg:page.ref}),sectionRef=ctx.register(section),elements=[];
  function marked(role,text,y,alt){const mc=elements.length;page.pushOperators(PDFOperator.of('BDC',[PDFName.of(role),ctx.obj({MCID:mc})]));page.drawText(text,{x:40,y,font,size:role.startsWith('H')?24:16});page.pushOperators(PDFOperator.of('EMC'));const el=ctx.obj({Type:'StructElem',S:role,P:sectionRef,Pg:page.ref,K:mc});if(alt)el.set(PDFName.of('Alt'),PDFString.of(alt));if(role==='P')el.set(PDFName.of('Lang'),PDFString.of('en'));elements.push(ctx.register(el));}
  marked(p?'H2':'H1',`Source heading ${p+1}`,730);marked('P',`Source paragraph ${p+1}.`,680);marked('Formula',p?'a + b = c':'x^2 + y^2 = z^2',620,p?null:'x squared plus y squared equals z squared');
  section.set(PDFName.of('K'),ctx.obj(elements));sections.push(sectionRef);parents.push(p,elements);page.node.set(PDFName.of('StructParents'),ctx.obj(p));
 }
 root.set(PDFName.of('K'),ctx.obj(sections));root.set(PDFName.of('ParentTree'),ctx.register(ctx.obj({Nums:parents})));root.set(PDFName.of('ParentTreeNextKey'),ctx.obj(2));doc.catalog.set(PDFName.of('StructTreeRoot'),rootRef);doc.catalog.set(PDFName.of('MarkInfo'),ctx.obj({Marked:true}));doc.catalog.set(PDFName.of('Lang'),PDFString.of('en'));
 return Buffer.from(await doc.save());
}
